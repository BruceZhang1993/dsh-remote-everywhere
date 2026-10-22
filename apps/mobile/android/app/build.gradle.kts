import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val localSigningFile = rootProject.file("../../../.signing/android/key.properties")
val useLocalSigning = System.getenv("CI") != "true" && localSigningFile.isFile
val localSigning = Properties().apply {
    if (useLocalSigning) localSigningFile.inputStream().use { load(it) }
}
fun signingValue(property: String, environment: String): String? =
    if (useLocalSigning) localSigning.getProperty(property) else System.getenv(environment)

val releaseStore = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")?.let {
    if (useLocalSigning) localSigningFile.parentFile.resolve(it) else file(it)
}
val releaseStorePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
val releaseAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
val hasReleaseSigning = releaseStore?.isFile == true && listOf(releaseStorePassword, releaseAlias, releaseKeyPassword).all { !it.isNullOrBlank() }
gradle.taskGraph.whenReady {
    val requiresSigning = System.getenv("DSH_REQUIRE_RELEASE_SIGNING") == "1" ||
        allTasks.any { it.project == project && it.name.contains("release", ignoreCase = true) }
    check(!requiresSigning || hasReleaseSigning) {
        "Release signing is required; configure .signing/android/key.properties or all four ANDROID_KEYSTORE/KEY variables."
    }
}

android {
    namespace = "dev.dshremote.dsh_remote_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "dev.dshremote.dsh_remote_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("distribution") {
            storeFile = releaseStore
            storePassword = releaseStorePassword
            keyAlias = releaseAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("distribution")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
