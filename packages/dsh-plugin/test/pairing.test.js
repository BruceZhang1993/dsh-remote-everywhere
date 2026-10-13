import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteServer, SecureConnection, connectTransport, deviceId } from '@dsh-remote/core'
import { DeviceStore } from '../src/store.js'
import { PairingHost } from '../src/pairing.js'
import { pairDevice } from '../src/client.js'

test('real encrypted pairing requires both SAS confirmations, persists trust and rejects QR reuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-pair-'))
  const host = new DeviceStore(join(directory, 'host'))
  const controller = new DeviceStore(join(directory, 'controller'))
  const pairing = new PairingHost(host, 'host')
  const server = await createRemoteServer({ keyPair: host.keyPair, connectionOptionsForRequest: request => pairing.claim(new URL(request.url, 'http://local').searchParams.get('sid')) })
  server.on('connection', connection => pairing.attach(connection))
  try {
    const qr = pairing.begin(server.endpoint)
    let hostConfirmed = false
    pairing.on('pending', pending => {
      assert.equal(host.find(controller.keyPair.publicKey), undefined)
      assert.throws(() => pairing.confirm('0000000'), { code: 'unauthorized' })
      pairing.confirm(pending.sas)
      hostConfirmed = true
    })
    const record = await pairDevice(controller, qr, async ({ sas }) => {
      assert.equal(sas, pairing.pending().sas)
      return true
    })
    assert.equal(hostConfirmed, true)
    assert.equal(record.deviceId, deviceId(host.keyPair.publicKey))
    assert.deepEqual(record.caps, [])
    assert.equal(controller.find(host.keyPair.publicKey), undefined, 'outbound trust does not grant inbound access')
    assert.equal(host.find(controller.keyPair.publicKey).caps.includes('admin'), false)
    assert.equal(new DeviceStore(join(directory, 'host')).find(controller.keyPair.publicKey).deviceId, deviceId(controller.keyPair.publicKey))
    assert.equal(statSync(join(directory, 'host', 'identity.key')).mode & 0o077, 0)
    await assert.rejects(pairDevice(controller, qr, async () => true))
  } finally {
    pairing.cancel(); await server.close(); host.close(); controller.close(); rmSync(directory, { recursive: true })
  }
})

test('unconfirmed local pairing grants no capabilities or trust and remote business calls are unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-pair-'))
  const host = new DeviceStore(join(directory, 'host'))
  const controller = new DeviceStore(join(directory, 'controller'))
  const pairing = new PairingHost(host, 'host')
  const server = await createRemoteServer({ keyPair: host.keyPair, connectionOptionsForRequest: request => pairing.claim(new URL(request.url, 'http://local').searchParams.get('sid')) })
  server.on('connection', connection => pairing.attach(connection))
  let connection
  try {
    const qr = pairing.begin(server.endpoint)
    connection = new SecureConnection(await connectTransport(`${server.endpoint}?sid=${qr.sid}`), { initiator: true, keyPair: controller.keyPair, peerPublicKey: host.keyPair.publicKey, pairSid: qr.sid, caps: ['admin'] })
    await connection.ready
    await assert.rejects(connection.request('session.list'), { code: 'unsupported' })
    const pending = connection.request('pair.confirm', { sas: connection.sas, deviceId: deviceId(controller.keyPair.publicKey) })
    pending.catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(host.find(controller.keyPair.publicKey), undefined)
    pairing.cancel()
    await assert.rejects(pending)
  } finally {
    connection?.close(); pairing.cancel(); await server.close(); host.close(); controller.close(); rmSync(directory, { recursive: true })
  }
})
