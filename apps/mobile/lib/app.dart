import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:file_selector/file_selector.dart';
import 'package:dsh_remote_core/remote_connection.dart';

import 'controller.dart';
import 'platform/identity_vault.dart';
import 'widgets/qr_scanner_page.dart';

class RemoteApp extends StatelessWidget {
  const RemoteApp({super.key, required this.controller});
  final MobileController controller;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'DSH Remote',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff2b5c91),
        brightness: Brightness.dark,
      ),
      useMaterial3: true,
    ),
    home: _RemoteHome(controller: controller),
  );
}

class _TextInputDialog extends StatefulWidget {
  const _TextInputDialog({
    required this.title,
    required this.value,
    this.hint,
    required this.lines,
  });
  final String title;
  final String value;
  final String? hint;
  final int lines;
  @override
  State<_TextInputDialog> createState() => _TextInputDialogState();
}

class _TextInputDialogState extends State<_TextInputDialog> {
  late final _input = TextEditingController(text: widget.value);
  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(
      controller: _input,
      autocorrect: false,
      enableSuggestions: false,
      smartDashesType: SmartDashesType.disabled,
      smartQuotesType: SmartQuotesType.disabled,
      minLines: widget.lines,
      maxLines: widget.lines + 4,
      autofocus: true,
      decoration: InputDecoration(hintText: widget.hint),
      textInputAction: widget.lines == 1
          ? TextInputAction.done
          : TextInputAction.newline,
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('取消'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, _input.text),
        child: const Text('确定'),
      ),
    ],
  );
}

class _RemoteHome extends StatefulWidget {
  const _RemoteHome({required this.controller});
  final MobileController controller;
  @override
  State<_RemoteHome> createState() => _RemoteHomeState();
}

class _RemoteHomeState extends State<_RemoteHome> {
  final _draft = TextEditingController();
  int _interactionCount = 0;
  MobileController get c => widget.controller;
  @override
  void initState() {
    super.initState();
    c.addListener(_showInteractions);
    unawaited(c.initialize());
  }

  void _showInteractions() {
    final count = c.interactions.length;
    if (mounted && count > 0 && _interactionCount == 0) {
      FocusScope.of(context).unfocus();
    }
    _interactionCount = count;
  }

  @override
  void dispose() {
    c.removeListener(_showInteractions);
    _draft.dispose();
    c.dispose();
    super.dispose();
  }

  Future<String?> _text(
    String title, {
    String value = '',
    String? hint,
    int lines = 1,
  }) => showDialog<String>(
    context: context,
    builder: (_) =>
        _TextInputDialog(title: title, value: value, hint: hint, lines: lines),
  );

  void _do(Future<void> Function() operation) => unawaited(c.action(operation));
  Future<void> _pair({bool scan = false}) async {
    final raw = scan
        ? await Navigator.push<String>(
            context,
            MaterialPageRoute(builder: (_) => const QrScannerPage()),
          )
        : await _text('粘贴配对二维码内容', hint: '在被控 DSH 上先开启配对，复制二维码 JSON', lines: 4);
    if (raw == null || raw.trim().isEmpty || !mounted) return;
    await c.action(() => c.pair(raw, _confirmPair));
  }

  Future<bool> _confirmPair(PairingRequest payload, String sas) async {
    if (!mounted) return false;
    Timer? expiry;
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        expiry ??= Timer(payload.expiresAt.difference(DateTime.now()), () {
          if (dialogContext.mounted) Navigator.pop(dialogContext, false);
        });
        return AlertDialog(
          title: Text('确认配对 · ${payload.name}'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('请与被控 DSH 显示的安全码逐位核对，并在该端同时确认。'),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: SelectableText(
                    sas,
                    style: const TextStyle(
                      fontSize: 36,
                      letterSpacing: 6,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                SelectableText('设备：${deviceId(payload.publicKey)}'),
                const SizedBox(height: 12),
                Text('授权能力：${payload.caps.join('、')}'),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('不一致 / 取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('安全码一致'),
            ),
          ],
        );
      },
    );
    expiry?.cancel();
    return result == true;
  }

  Future<void> _connect(TrustedDevice target) async {
    if (target.endpoints.isNotEmpty) {
      await c.action(() => c.connect(target, target.endpoints.first));
      return;
    }
    await _editEndpoint(target);
  }

  Future<void> _editEndpoint(TrustedDevice target) async {
    if (target.endpoints.isNotEmpty) {
      final selected = await showDialog<String>(
        context: context,
        builder: (context) => SimpleDialog(
          title: Text('连接地址 · ${target.name}'),
          children: [
            for (final endpoint in target.endpoints)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, endpoint),
                child: Text(endpoint),
              ),
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, ''),
              child: const Text('输入新地址'),
            ),
          ],
        ),
      );
      if (selected == null || !mounted) return;
      if (selected.isNotEmpty) {
        await c.action(() => c.connect(target, selected));
        return;
      }
    }
    final endpoint = await _text(
      '连接 ${target.name}',
      value: target.endpoints.firstOrNull ?? '',
      hint: 'wss://…/remote/ws',
    );
    if (endpoint != null && endpoint.trim().isNotEmpty) {
      await c.action(() => c.connect(target, endpoint.trim()));
    }
  }

  Future<void> _newSession() async {
    if (c.workspaces.isNotEmpty) {
      final selected = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('选择工作区'),
          children: [
            for (final item in c.workspaces)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, item),
                child: Text('${item['title'] ?? item['path']}'),
              ),
          ],
        ),
      );
      if (selected != null) {
        await c.action(
          () => c.createSession({'workspaceId': selected['workspaceId']}),
        );
      }
    } else {
      final cwd = await _text('工作区路径', hint: '被控 DSH 的工作区绝对路径');
      if (cwd != null && cwd.isNotEmpty) {
        await c.action(() => c.createSession({'cwd': cwd}));
      }
    }
  }

  Future<void> _details(String title, Object? value) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: SelectableText(
              _display(value),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }

  static String _display(Object? value) {
    final text = value is String
        ? value
        : const JsonEncoder.withIndent('  ').convert(value);
    return text.length <= 32768
        ? text
        : '${text.substring(0, 32768)}\n[显示已截断，共 ${utf8.encode(text).length} 字节]';
  }

  Future<void> _attach(bool image) async {
    try {
      final file = await openFile(
        acceptedTypeGroups: image
            ? [
                const XTypeGroup(
                  label: '图片',
                  extensions: ['png', 'jpg', 'jpeg', 'webp'],
                  uniformTypeIdentifiers: [
                    'public.png',
                    'public.jpeg',
                    'org.webmproject.webp',
                  ],
                ),
              ]
            : [],
      );
      if (file == null) return;
      if (await file.length() > 4 * 1024 * 1024) {
        throw const RemoteException('invalid-argument', '附件不能超过 4 MiB');
      }
      final buffer = BytesBuilder(copy: false);
      await for (final chunk in file.openRead(0, 4 * 1024 * 1024 + 1)) {
        if (buffer.length + chunk.length > 4 * 1024 * 1024) {
          throw const RemoteException('invalid-argument', '附件不能超过 4 MiB');
        }
        buffer.add(chunk);
      }
      final bytes = buffer.takeBytes();
      final extension = file.name.split('.').last.toLowerCase();
      final mediaType = image
          ? extension == 'png'
                ? 'image/png'
                : extension == 'webp'
                ? 'image/webp'
                : 'image/jpeg'
          : null;
      await c.action(() async {
        await c.ensureConnected();
        await c.attach(bytes, file.name, mediaType: mediaType);
      });
    } catch (error) {
      c.report(error);
    }
  }

  Future<void> _sessionAction(String action) async {
    switch (action) {
      case 'rename':
        final title = await _text(
          '重命名会话',
          value: '${c.session.header['title'] ?? ''}',
        );
        if (title != null && title.isNotEmpty) {
          await c.action(() async {
            await c.call('session.rename', {
              'sessionId': c.sessionId,
              'title': title,
            });
            await c.refresh();
          });
        }
      case 'fork':
        await c.action(() async {
          final result = await c.call('session.fork', {
            'sessionId': c.sessionId,
          });
          await c.refresh();
          await c.selectSession({
            'kind': 'session',
            'sessionId': result['sessionId'],
          });
        });
      case 'queue':
        await _queue();
      case 'children':
        await _children();
      case 'files':
        await _files();
      case 'terminal':
        final command = await _text(
          '运行命令 · 每次需审批',
          hint: '在当前会话工作区执行，最长 30 秒',
          lines: 2,
        );
        if (command != null && command.trim().isNotEmpty) {
          await c.action(() async {
            final result = await c.operation('terminal.exec', {
              'command': command,
              'cwd': '.',
            });
            await _details('终端结果', result);
          });
        }
      case 'diff':
        final changes = c.session.records.where(
          (record) => record['event']['type'] == 'workspace/changes',
        );
        if (changes.isEmpty) {
          await _details('代码变更', '当前历史窗口中没有文件变更');
          return;
        }
        await c.action(() async {
          final seq = changes.last['event']['seq'];
          final summary = await c.call('changes.summary', {
            'sessionId': c.sessionId,
            'seq': seq,
          });
          if (!mounted) return;
          final selected = await showDialog<Map<String, dynamic>>(
            context: context,
            builder: (context) => SimpleDialog(
              title: const Text('代码变更'),
              children: [
                for (final file in summary['files'] as List)
                  SimpleDialogOption(
                    onPressed: () => Navigator.pop(
                      context,
                      Map<String, dynamic>.from(file as Map),
                    ),
                    child: Text('${file['path']}'),
                  ),
                if ((summary['files'] as List).isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('没有保留的文件变更'),
                  ),
              ],
            ),
          );
          if (selected != null) {
            final result = await c.readStream('changes.diff', {
              'sessionId': c.sessionId,
              'seq': seq,
              'index': selected['index'],
            });
            await _details('代码 diff', result);
          }
        });
    }
  }

  Future<void> _queue() async {
    await c.action(() async {
      final result = await c.call('session.projections', {
        'sessionId': c.sessionId,
      });
      final inbox = result['values']?['inbox'] as Map? ?? {};
      final items = [
        for (final group in inbox.values)
          if (group is List) ...group,
      ];
      if (!mounted) return;
      final item = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('提示队列'),
          children: [
            for (final value in items)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(
                  context,
                  Map<String, dynamic>.from(value as Map),
                ),
                child: Text(_display(value['content'])),
              ),
            if (items.isEmpty)
              const Padding(padding: EdgeInsets.all(24), child: Text('队列为空')),
          ],
        ),
      );
      if (item == null || !mounted) return;
      final kind = await showDialog<String>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('队列操作'),
          children: [
            for (final entry in {
              'edit': '编辑',
              'steer': '转为下一步',
              'remove': '移除',
            }.entries)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, entry.key),
                child: Text(entry.value),
              ),
          ],
        ),
      );
      if (kind == null) return;
      final text = kind == 'edit' ? await _text('编辑队列提示', lines: 3) : null;
      if (kind == 'edit' && (text == null || text.trim().isEmpty)) return;
      await c.call('session.queue.update', {
        'sessionId': c.sessionId,
        'itemId': item['id'],
        'action': {
          'kind': kind,
          if (kind == 'edit')
            'content': [
              {'type': 'text', 'text': text},
            ],
        },
      });
    });
  }

  Future<void> _children() async {
    await c.action(() async {
      final result = await c.call('subagent.list', {'sessionId': c.sessionId});
      if (!mounted) return;
      final child = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('子代理'),
          children: [
            for (final item in result['items'] as List)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(
                  context,
                  Map<String, dynamic>.from(item as Map),
                ),
                child: Text('${item['label'] ?? item['id']} · ${item['mode']}'),
              ),
            if ((result['items'] as List).isEmpty)
              const Padding(padding: EdgeInsets.all(24), child: Text('暂无子代理')),
          ],
        ),
      );
      if (child != null) {
        await c.selectSession({
          'kind': 'subagent',
          'parentSessionId': c.sessionId,
          'childSessionId': child['id'],
          'mode': child['mode'],
        });
      }
    });
  }

  Future<void> _files() async {
    final path = await _text('工作区文件路径', value: '.', hint: '相对于当前会话工作区');
    if (path == null || path.isEmpty) return;
    if (!mounted) return;
    final mode = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(path),
        children: [
          for (final entry in {
            'list': '列出目录',
            'read': '读取文件（32 KiB 窗口）',
            'write': '写入文本 · 需审批',
          }.entries)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, entry.key),
              child: Text(entry.value),
            ),
        ],
      ),
    );
    if (mode == 'write') {
      final text = await _text('写入 $path', lines: 5);
      if (text != null) {
        await c.action(() async {
          await c.operation('files.write', {'path': path, 'content': text});
          await _details('写入完成', {
            'path': path,
            'bytes': utf8.encode(text).length,
          });
        });
      }
    } else if (mode != null) {
      final offset = mode == 'read' ? await _text('读取偏移（字节）', value: '0') : '0';
      if (offset == null) return;
      await c.action(() async {
        final result = await c.call('files.$mode', {
          'sessionId': c.sessionId,
          'path': path,
          'offset': int.parse(offset),
        });
        await _details(
          path,
          mode == 'read'
              ? {
                  'offset': result['offset'],
                  'bytes': result['bytes'],
                  'eof': result['eof'],
                  'text': utf8.decode(
                    base64.decode(result['data']),
                    allowMalformed: true,
                  ),
                }
              : result,
        );
      });
    }
  }

  Widget _devices() => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const Text(
        '连接你的 DSH',
        style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
      ),
      const SizedBox(height: 8),
      const Text('会话留在被控端。连接前核对设备身份，敏感操作由你审批。'),
      const SizedBox(height: 24),
      Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          FilledButton.icon(
            onPressed: c.initialized && !c.busy
                ? () => _pair(scan: true)
                : null,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('扫码配对'),
          ),
          OutlinedButton.icon(
            onPressed: c.initialized && !c.busy ? () => _pair() : null,
            icon: const Icon(Icons.content_paste),
            label: const Text('粘贴二维码'),
          ),
        ],
      ),
      if (c.busy)
        TextButton(onPressed: c.cancelPairing, child: const Text('取消配对')),
      const SizedBox(height: 28),
      Text(
        '信任设备 · ${c.devices.length}',
        style: Theme.of(context).textTheme.titleMedium,
      ),
      if (c.devices.isEmpty)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 32),
          child: Text('尚未配对设备。请先在 DSH 上开启配对。'),
        ),
      for (final target in c.devices)
        Card(
          child: ListTile(
            leading: const Icon(Icons.computer),
            title: Text(target.name),
            subtitle: Text('${target.deviceId}\n${target.caps.join(' · ')}'),
            isThreeLine: true,
            onTap: !c.busy ? () => _connect(target) : null,
            trailing: PopupMenuButton<String>(
              enabled: !c.busy,
              onSelected: (value) async {
                if (value == 'endpoint') await _editEndpoint(target);
                if (value == 'rename') {
                  final name = await _text('设备名称', value: target.name);
                  if (name != null) _do(() => c.renameDevice(target, name));
                }
                if (value == 'forget' && mounted) {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('移除本机信任记录？'),
                      content: const Text('如需吊销手机权限，请在被控 DSH 上执行设备吊销。'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('取消'),
                        ),
                        FilledButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('移除'),
                        ),
                      ],
                    ),
                  );
                  if (ok == true) _do(() => c.forget(target));
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'endpoint', child: Text('连接地址')),
                PopupMenuItem(value: 'rename', child: Text('改名')),
                PopupMenuItem(value: 'forget', child: Text('移除本机记录')),
              ],
            ),
          ),
        ),
    ],
  );
  Widget _sessions() => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      Row(
        children: [
          Expanded(
            child: Text('会话', style: Theme.of(context).textTheme.headlineSmall),
          ),
          FilledButton.icon(
            onPressed: c.has('session') && !c.busy ? _newSession : null,
            icon: const Icon(Icons.add),
            label: const Text('新建'),
          ),
        ],
      ),
      const SizedBox(height: 12),
      TextField(
        decoration: const InputDecoration(
          prefixIcon: Icon(Icons.search),
          hintText: '搜索会话内容（需宿主启用）',
          border: OutlineInputBorder(),
        ),
        onSubmitted: (query) => _do(() => c.refresh(query: query)),
      ),
      if (c.sessions.isEmpty)
        const Padding(
          padding: EdgeInsets.all(28),
          child: Text('暂无会话，或设备尚未连接。'),
        ),
      for (final item in c.sessions)
        Card(
          child: ListTile(
            title: Text(
              '${item['title'] ?? item['header']?['title'] ?? item['sessionId'] ?? item['id']}',
            ),
            subtitle: Text('${item['cwd'] ?? item['header']?['cwd'] ?? ''}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: c.has('stream') && !c.busy
                ? () => _do(
                    () => c.selectSession({
                      'kind': 'session',
                      'sessionId': item['sessionId'] ?? item['id'],
                    }),
                  )
                : null,
          ),
        ),
    ],
  );
  Widget _chat() {
    final messages = c.session.messages;
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      itemCount: messages.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return c.session.hasMore
              ? TextButton(
                  onPressed: !c.busy && c.connected ? () => _do(c.older) : null,
                  child: const Text('加载更早历史'),
                )
              : const SizedBox(height: 8);
        }
        final message = messages[index - 1];
        final source =
            message.data['source'] ?? message.data['message']?['source'];
        final contextRow =
            message.role == 'system' ||
            message.role == 'developer' ||
            message.role == 'user' && source is Map && source['kind'] != 'user';
        if (contextRow) {
          return Card(
            child: ExpansionTile(
              title: const Text('会话上下文'),
              subtitle: Text(
                source is Map ? '${source['kind']}' : message.role,
              ),
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: _messageBody(message.text),
                ),
              ],
            ),
          );
        }
        final user = message.role == 'user';
        return Align(
          alignment: user ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            constraints: const BoxConstraints(maxWidth: 760),
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: user
                  ? Theme.of(context).colorScheme.primaryContainer
                  : Theme.of(context).colorScheme.surfaceContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  message.role == 'user'
                      ? '你'
                      : message.role == 'assistant'
                      ? message.transient
                            ? '助手 · 输出中'
                            : '助手'
                      : message.toolName ?? '工具',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                if (message.reasoning.isNotEmpty)
                  ExpansionTile(
                    title: const Text('推理过程'),
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: SelectableText(message.reasoning),
                      ),
                    ],
                  ),
                if (message.text.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _messageBody(message.text),
                  ),
                if (message.role.startsWith('tool'))
                  TextButton.icon(
                    onPressed: () =>
                        _details(message.toolName ?? '工具详情', message.data),
                    icon: const Icon(Icons.code),
                    label: const Text('查看调用 / 结果'),
                  ),
                for (final part in message.content)
                  if (part['type'] == 'image' || part['type'] == 'file')
                    TextButton.icon(
                      onPressed: () => _attachment(part),
                      icon: const Icon(Icons.attachment),
                      label: Text('${part['name'] ?? part['type']} · 查看附件'),
                    ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _messageBody(String text) {
    final blocks = _display(text).split('```');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < blocks.length; i++)
          if (blocks[i].isNotEmpty)
            i.isOdd
                ? Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: Theme.of(context)
                          .colorScheme
                          .surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SelectableText(
                      blocks[i],
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 13,
                      ),
                    ),
                  )
                : SelectableText(blocks[i]),
      ],
    );
  }

  Future<void> _attachment(Map<String, dynamic> part) async {
    final ref = part['attachment'] as Map?;
    if (ref == null) {
      await _details('附件资料', part);
      return;
    }
    await c.action(() async {
      final value = await c.call('session.attachment', {
        'sessionId': c.sessionId,
        'attachmentId': ref['attachmentId'],
      });
      if (part['type'] == 'image' && mounted) {
        final bytes = base64.decode(value['data']);
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            content: Image.memory(
              bytes,
              errorBuilder: (_, error, stack) => const Text('图片无法显示'),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('关闭'),
              ),
            ],
          ),
        );
      } else {
        await _details('附件资料', value['attachment']);
      }
    });
  }

  Widget _compose() => SafeArea(
    top: false,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (c.pendingPrompt != null)
            Row(
              children: [
                const Expanded(child: Text('发送结果待确认，重试将使用同一提示 ID。')),
                TextButton(
                  onPressed: c.connected && !c.busy
                      ? () => _do(c.retryPrompt)
                      : null,
                  child: const Text('重试'),
                ),
              ],
            ),
          if (c.attachments.isNotEmpty)
            Wrap(
              spacing: 8,
              children: [
                for (var index = 0; index < c.attachments.length; index++)
                  InputChip(
                    deleteButtonTooltipMessage: '移除附件 ${index + 1}',
                    label: Text(
                      '${c.attachments[index]['type'] == 'image' ? '图片' : '附件'} ${index + 1}',
                    ),
                    onDeleted: !c.busy && c.pendingPrompt == null
                        ? () => setState(() => c.attachments.removeAt(index))
                        : null,
                  ),
              ],
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              PopupMenuButton<bool>(
                enabled:
                    c.has('session') &&
                    !c.busy &&
                    c.address?['kind'] != 'subagent',
                tooltip: '添加附件',
                onSelected: _attach,
                itemBuilder: (_) => const [
                  PopupMenuItem(value: false, child: Text('选择文件')),
                  PopupMenuItem(value: true, child: Text('选择小图片')),
                ],
                icon: const Icon(Icons.attach_file),
              ),
              Expanded(
                child: TextField(
                  controller: _draft,
                  autocorrect: false,
                  enableSuggestions: false,
                  minLines: 1,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    hintText: '向此会话发送提示…',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              IconButton.filled(
                onPressed:
                    c.has('session') &&
                        !c.busy &&
                        c.pendingPrompt == null &&
                        (c.address?['kind'] != 'subagent' ||
                            c.address?['mode'] == 'continuable')
                    ? () => _do(() async {
                        final text = _draft.text;
                        await c.prompt(text);
                        _draft.clear();
                      })
                    : null,
                tooltip: '发送提示',
                icon: const Icon(Icons.send),
              ),
              IconButton(
                onPressed: c.has('session') && !c.busy
                    ? () => _do(c.cancelTask)
                    : null,
                tooltip: '停止任务',
                icon: const Icon(Icons.stop_circle_outlined),
              ),
            ],
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: c,
    builder: (context, _) => Scaffold(
      appBar: AppBar(
        title: Text(
          c.address != null
              ? '${c.session.header['title'] ?? '会话'}'
              : c.device?.name ?? 'DSH Remote',
        ),
        leading: c.device != null
            ? IconButton(
                tooltip: '返回',
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  _draft.clear();
                  _do(() async {
                    if (c.address != null) {
                      await c.selectSession(null);
                    } else {
                      await c.disconnect();
                      c.device = null;
                    }
                  });
                },
              )
            : null,
        actions: [
          if (c.device != null)
            IconButton(
              tooltip: '刷新会话',
              onPressed: c.connected && !c.busy ? () => _do(c.refresh) : null,
              icon: const Icon(Icons.refresh),
            ),
          if (c.address != null)
            PopupMenuButton<String>(
              enabled: c.connected && !c.busy,
              onSelected: _sessionAction,
              itemBuilder: (_) => [
                if (c.address?['kind'] != 'subagent') ...const [
                  PopupMenuItem(value: 'rename', child: Text('重命名')),
                  PopupMenuItem(value: 'fork', child: Text('分叉会话')),
                  PopupMenuItem(value: 'queue', child: Text('提示队列')),
                  PopupMenuItem(value: 'children', child: Text('子代理')),
                ],
                if (c.has('files')) ...const [
                  PopupMenuItem(value: 'files', child: Text('工作区文件')),
                  PopupMenuItem(value: 'diff', child: Text('代码变更')),
                ],
                if (c.has('terminal'))
                  const PopupMenuItem(value: 'terminal', child: Text('运行命令')),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(c.connected ? Icons.lock : Icons.link_off, size: 16),
                const SizedBox(width: 8),
                Expanded(child: Text(c.status)),
                if (c.busy)
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
          if (c.error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                c.error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          Expanded(
            child: c.device == null
                ? _devices()
                : c.address == null
                ? _sessions()
                : _chat(),
          ),
          if (c.interactions.isNotEmpty)
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: min(
                  320,
                  max(
                    96,
                    (MediaQuery.sizeOf(context).height -
                            MediaQuery.viewInsetsOf(context).bottom) *
                        0.4,
                  ),
                ),
              ),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final item in c.interactions.values)
                    InteractionCard(
                      key: ValueKey(item.id),
                      item: item,
                      controller: c,
                    ),
                ],
              ),
            ),
          if (c.address != null) _compose(),
        ],
      ),
    ),
  );
}

class InteractionCard extends StatefulWidget {
  const InteractionCard({
    super.key,
    required this.item,
    required this.controller,
  });
  final PendingInteraction item;
  final MobileController controller;
  @override
  State<InteractionCard> createState() => _InteractionCardState();
}

class _InteractionCardState extends State<InteractionCard> {
  final Map<String, Set<String>> _answers = {};
  final Map<String, TextEditingController> _custom = {};
  @override
  void dispose() {
    for (final field in _custom.values) {
      field.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final enabled = !item.sending && widget.controller.connected;
    final questions = item.data['questions'] as List? ?? [];
    return Card(
      color: Theme.of(context).colorScheme.secondaryContainer,
      margin: const EdgeInsets.all(12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item.kind == 'approval'
                  ? '需要你的审批 · ${item.data['toolName'] ?? '操作'}'
                  : '需要你的回答',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (item.kind == 'approval') ...[
              const SizedBox(height: 8),
              SelectableText(
                _RemoteHomeState._display(item.data['reason'] ?? '被控端未提供其他说明'),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                children: [
                  OutlinedButton(
                    onPressed: enabled
                        ? () => widget.controller.decide(item, 'rejected')
                        : null,
                    child: const Text('拒绝'),
                  ),
                  FilledButton(
                    onPressed: enabled
                        ? () => widget.controller.decide(item, 'allowed-once')
                        : null,
                    child: const Text('仅允许这一次'),
                  ),
                ],
              ),
            ] else ...[
              for (final question in questions) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text('${question['question']}'),
                ),
                for (final option in question['options'] as List? ?? [])
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text('${option['label']}'),
                    subtitle: option['description'] == null
                        ? null
                        : Text('${option['description']}'),
                    value:
                        _answers['${question['id']}']?.contains(
                          '${option['label']}',
                        ) ==
                        true,
                    onChanged: enabled
                        ? (checked) => setState(() {
                            final answers = _answers.putIfAbsent(
                              '${question['id']}',
                              () => {},
                            );
                            if (question['multiSelect'] != true) {
                              answers.clear();
                            }
                            if (checked == true) {
                              answers.add('${option['label']}');
                            }
                          })
                        : null,
                  ),
                TextField(
                  controller: _custom.putIfAbsent(
                    '${question['id']}',
                    () => TextEditingController(),
                  ),
                  enabled: enabled,
                  decoration: const InputDecoration(labelText: '补充回答'),
                  onChanged: (_) => setState(() {}),
                ),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed:
                    enabled &&
                        questions.every(
                          (q) =>
                              (_answers['${q['id']}']?.isNotEmpty ?? false) ||
                              (_custom['${q['id']}']?.text.trim().isNotEmpty ??
                                  false),
                        )
                    ? () => widget.controller.decide(item, {
                        'answers': [
                          for (final question in questions)
                            {
                              'id': question['id'],
                              'selected':
                                  _answers['${question['id']}']?.toList() ?? [],
                              if (_custom['${question['id']}']?.text
                                      .trim()
                                      .isNotEmpty ??
                                  false)
                                'custom': _custom['${question['id']}']!.text,
                            },
                        ],
                      })
                    : null,
                child: const Text('提交回答'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
