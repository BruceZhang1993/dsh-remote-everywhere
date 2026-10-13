import 'package:flutter/material.dart';

import 'app.dart';
import 'controller.dart';
import 'platform/identity_vault.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(RemoteApp(controller: MobileController(IdentityVault())));
}
