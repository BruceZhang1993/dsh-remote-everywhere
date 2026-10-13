import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class QrScannerPage extends StatefulWidget {
  const QrScannerPage({super.key});

  @override
  State<QrScannerPage> createState() => _QrScannerPageState();
}

class _QrScannerPageState extends State<QrScannerPage>
    with WidgetsBindingObserver {
  final _scanner = MobileScannerController(
    autoStart: false,
    formats: const [BarcodeFormat.qrCode],
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _returned = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _startScanner();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_returned || !_scanner.value.hasCameraPermission) return;
    if (state == AppLifecycleState.resumed) {
      _startScanner();
    } else {
      unawaited(_scanner.stop());
    }
  }

  void _startScanner() {
    if (!mounted ||
        _returned ||
        _scanner.value.isStarting ||
        _scanner.value.isRunning) {
      return;
    }
    unawaited(_scanner.start());
  }

  void _onDetect(BarcodeCapture capture) {
    if (!mounted || _returned) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null || raw.isEmpty) continue;
      _returned = true;
      Navigator.pop(context, raw);
      return;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_scanner.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('扫描设备二维码')),
    body: Column(
      children: [
        Expanded(
          child: MobileScanner(
            controller: _scanner,
            onDetect: _onDetect,
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  error.errorCode == MobileScannerErrorCode.permissionDenied
                      ? '相机权限未允许。请在系统设置中开启权限，或返回粘贴二维码内容。'
                      : '相机无法启动。请返回重试，或粘贴二维码内容。',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
        ),
        const Padding(
          padding: EdgeInsets.all(20),
          child: Text('对准 DSH 的配对二维码，扫描后核对设备身份与安全码。'),
        ),
      ],
    ),
  );
}
