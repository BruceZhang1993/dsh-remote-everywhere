import { VERSION, encodeHeader, assertValue, type Hello, type Request } from '@dsh-remote/protocol'

const hello: Hello = {
  type: 'hello', vmin: VERSION, vmax: VERSION, caps: ['diagnostic'],
  role: 'controller', kind: 'cli', deviceId: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'consumer',
}
const request: Request = { id: 'AAAAAAAAAAA', m: 'diagnostic.echo', p: { hello } }
assertValue('Request', request)
encodeHeader({ kind: 1, streamId: 0, seq: 0 })
// @ts-expect-error invalid roles must not compile at the public package boundary.
const invalid: Hello['role'] = 'observer'
void invalid
