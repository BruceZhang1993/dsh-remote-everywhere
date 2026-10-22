import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dsh_remote_mobile/app.dart';
import 'package:dsh_remote_mobile/controller.dart';
import 'package:dsh_remote_mobile/platform/identity_vault.dart';

void main() {
  testWidgets(
    'paired device connects with its saved address without a dialog',
    (tester) async {
      final controller = await _withHistory([
        'wss://192.168.1.20:47311/remote/ws',
        'wss://desktop.example.com/remote/ws',
      ]);
      await tester.pumpWidget(RemoteApp(controller: controller));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Saved desktop'));
      await tester.pumpAndSettle();
      expect(controller.connections, ['wss://192.168.1.20:47311/remote/ws']);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.byType(TextField), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('device menu switches history or accepts a replacement address', (
    tester,
  ) async {
    final controller = await _withHistory([
      'wss://192.168.1.20:47311/remote/ws',
      'wss://desktop.example.com/remote/ws',
    ]);
    await tester.pumpWidget(RemoteApp(controller: controller));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('连接地址'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('wss://desktop.example.com/remote/ws'));
    await tester.pumpAndSettle();
    expect(controller.connections, ['wss://desktop.example.com/remote/ws']);
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('连接地址'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('输入新地址'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField),
      '  wss://new.example.com/remote/ws  ',
    );
    await tester.tap(find.text('确定'));
    await tester.pumpAndSettle();
    expect(controller.connections.last, 'wss://new.example.com/remote/ws');
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'legacy paired device asks for an address and cancellation does not connect',
    (tester) async {
      final controller = await _withHistory([]);
      await tester.pumpWidget(RemoteApp(controller: controller));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Saved desktop'));
      await tester.pumpAndSettle();
      expect(find.text('连接 Saved desktop'), findsOneWidget);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(controller.connections, isEmpty);
      await tester.tap(find.text('Saved desktop'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        'wss://desktop.example.com/remote/ws',
      );
      await tester.tap(find.text('确定'));
      await tester.pumpAndSettle();
      expect(controller.connections, ['wss://desktop.example.com/remote/ws']);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('incoming human question releases the composer keyboard focus', (
    tester,
  ) async {
    final controller = MobileController(
      IdentityVault(store: FakeKeyValueStore()),
    );
    await controller.initialize();
    controller.device = TrustedDevice(
      deviceId: controller.identity!.deviceId,
      publicKey: base64Url.encode(controller.identity!.publicKey),
      name: 'Test',
      caps: ['session', 'stream', 'approval'],
    );
    controller.address = {'kind': 'session', 'sessionId': 'test'};
    await tester.pumpWidget(RemoteApp(controller: controller));
    await tester.pumpAndSettle();
    final composer = tester.widget<EditableText>(find.byType(EditableText));
    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();
    expect(composer.focusNode.hasFocus, isTrue);
    controller.interactions['q'] = PendingInteraction('question', {
      'questionId': 'q',
      'questions': [
        {
          'id': 'q',
          'question': 'Read before answering',
          'options': [
            {'label': 'Proceed'},
          ],
        },
      ],
    });
    controller.notifyListeners();
    await tester.pumpAndSettle();
    expect(composer.focusNode.hasFocus, isFalse);
    expect(find.text('Read before answering'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });

  testWidgets('draft attachments can be removed before sending', (
    tester,
  ) async {
    final controller = MobileController(
      IdentityVault(store: FakeKeyValueStore()),
    );
    await controller.initialize();
    controller.device = TrustedDevice(
      deviceId: controller.identity!.deviceId,
      publicKey: base64Url.encode(controller.identity!.publicKey),
      name: 'Test',
      caps: ['session', 'stream'],
    );
    controller.address = {'kind': 'session', 'sessionId': 'test'};
    controller.attachments.addAll([
      {'type': 'image', 'data': 'eA=='},
      {'type': 'file', 'receiptId': 'test'},
    ]);
    await tester.pumpWidget(RemoteApp(controller: controller));
    await tester.pumpAndSettle();
    expect(find.byType(InputChip), findsNWidgets(2));
    await tester.tap(find.byTooltip('移除附件 1'));
    await tester.pumpAndSettle();
    expect(controller.attachments.single['type'], 'file');
    expect(find.byType(InputChip), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });

  testWidgets(
    'pairing dialog uses navigator and malformed QR grants no trust',
    (tester) async {
      final store = FakeKeyValueStore();
      final controller = MobileController(IdentityVault(store: store));
      await tester.pumpWidget(RemoteApp(controller: controller));
      await tester.pumpAndSettle();
      expect(find.text('信任设备 · 0'), findsOneWidget);
      await tester.tap(find.text('粘贴二维码'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'invalid-json');
      await tester.tap(find.text('确定'));
      await tester.pumpAndSettle();
      expect(controller.devices, isEmpty);
      expect(store.values.containsKey('trusted-devices-v1'), isFalse);
      expect(controller.error, isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'corrupt secure identity disables onboarding without replacing it',
    (tester) async {
      final store = FakeKeyValueStore();
      store.values['identity-v1'] = base64Url.encode([1]);
      final controller = MobileController(IdentityVault(store: store));
      await tester.pumpWidget(RemoteApp(controller: controller));
      await tester.pumpAndSettle();
      expect(controller.initialized, isFalse);
      expect(find.text('安全存储不可用'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '扫码配对'))
            .onPressed,
        isNull,
      );
      expect(store.values['identity-v1'], base64Url.encode([1]));
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );

  testWidgets('offline approval is never actionable or auto-approved', (
    tester,
  ) async {
    final controller = MobileController(
      IdentityVault(store: FakeKeyValueStore()),
    );
    final item = PendingInteraction('approval', {
      'approvalId': 'test',
      'toolName': 'terminal.exec',
      'reason': 'command',
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: InteractionCard(item: item, controller: controller),
        ),
      ),
    );
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, '仅允许这一次'))
          .onPressed,
      isNull,
    );
    expect(item.sending, isFalse);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
    await tester.pumpAndSettle();
  });
}

class _RecordingController extends MobileController {
  _RecordingController(super.vault);
  final connections = <String>[];

  @override
  Future<void> connect(TrustedDevice target, String endpoint) async {
    connections.add(endpoint);
  }
}

Future<_RecordingController> _withHistory(List<String> endpoints) async {
  final vault = IdentityVault(store: FakeKeyValueStore());
  final identity = await vault.loadIdentity();
  await vault.saveDevices([
    TrustedDevice(
      deviceId: identity.deviceId,
      publicKey: base64Url.encode(identity.publicKey),
      name: 'Saved desktop',
      caps: ['session'],
      endpoints: endpoints,
    ),
  ]);
  final controller = _RecordingController(vault);
  await controller.initialize();
  return controller;
}
