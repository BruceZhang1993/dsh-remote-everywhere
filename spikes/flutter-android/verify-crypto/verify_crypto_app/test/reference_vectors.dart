// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by: tool/gen_reference_vectors.py
// Independent references from CPython hashlib/hmac (OpenSSL) + pyca/cryptography.
// ignore_for_file: lines_longer_than_80_chars

/// BLAKE2s-256 of "abc" (published vector, RFC 7693 Appendix A style).
const String blake2sAbcRef =
    '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982';

/// Independent BLAKE2s-256 digests of pattern(n), keyed by input length.
const Map<int, String> blake2sRef = <int, String>{
  0: '69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9',
  1: 'b480c25c1e06eea9e9c3e36754715cf0958e4d14b22a8c2a7bc34ebf75208602',
  3: '78aed3ef881bf9d82b78f27f6b8b585fef960b816a13fe987fedfb96fea5f0f8',
  31: '632fd86e9c7e23ab098037a0a07afcf80557826f665835ee99c6f3ee38998416',
  32: 'ff6d6151531fefb38b881ee447dee451a9715fad1e304d2558521c4bb3b68f9c',
  33: '36e08c81ec7ddf8fdc2f2a216d32cf8de6d38e834d65e04df2b90f7468c5f2f2',
  63: '097f3e7144ca0dd305c5a34309dee329232e9209f1e5c95d7e40d780b3b2f9d8',
  64: 'f02a59ea09f0833643e84d678cdf5cf0ffe524920c8354235df818c8594e2be1',
  65: '0ac3d13a7ed2af4933f533819602898ba90117906214882c968be7f380820b1e',
  127: '91b215624b77e35fc4d5bcaa8fe04c6a97a6731b540ba6e0ecd74918feafd4c6',
  128: 'cdc7339cef2a93111ccfef5ae8a84bae69fce8d458a10ad486ab801c71c817fc',
  129: '126d98599abde4039d55b7c81ad9e19b806cd749e3369f384fa6dfaf51088a82',
  255: '0088f842f11ab7ed95a5d4302bd89fe7923331863858a8034b35d946663bb5b5',
  256: '87a930f9d7ffeb0fb7b0cb9931eae70def91221ebcc438b1f3c3bde9ac4eeb63',
  1000: '250e5108aab618828bf10662138a1f156906a1e12644c370ddf79fec86ab666d',
};

/// Native keyed BLAKE2s (BLAKE2s keyed mode, NOT HMAC), key = bytes(0..31).
const Map<int, String> keyedBlake2sRef = <int, String>{
  0: '48a8997da407876b3d79c0d92325ad3b89cbb754d86ab71aee047ad345fd2c49',
  1: 'e2c4077ce2da96db75a2f8478711a01b2a6ba71d654193eba5b6d3b9a9101aea',
  3: '65a5aab4dbd6cf14cedc75300b80909cbb5aaea6700f03ab1e6e921cb261e4a7',
  31: '0fa774f2a91a2eb631f917dd719d36a2aecfd830b57f9eff288a8f80a1520614',
  32: '782701e7690ce38188d5190c6d0c0eca37f8e33e0cb1af378c431dd2c5cf2b5a',
  33: '67505f179bc81d22e4bc888ca237de0699b39b7eee3f36c87c461f682a4bc0a3',
  63: '66d5cf5253699255da9dcc21e9f06b5d9eb527a6fc46b3939d6de37bd18eab8f',
  64: 'dd1c522f01b10d46b8a8ba7a9086a83fb26317975b79286a02dcb27c8bfda415',
  65: '27971e7f19f5f98eed39daf726b9ab24c5226b4686997a28fa902c589c33f706',
  127: '0c9cda07070e57088f5ae1b388ff8d792b0ea1e08ad553337a12f051d161c4bc',
  128: '06d0f85f789a3156b8a12eecaab3686d01b158d25b12b3dd1bca4678a94d8431',
  129: '5717bfa5c360fbebe8da94bccbb7427f5a4b6a62cc636f010e6f260179ff07f1',
  255: '0a7feb6b5e9625dff49df378db0b24440a0dfdda721b192c287fae7147ecbf66',
  256: '395753fdda6403446dfaf580e86a772b236956f1a233332b7663ad9ccd5fd419',
  1000: 'd647422656af100260dd36d28b0b71911c39e7c83cdf6aebd66a7feac4b5f694',
};

/// Textbook HMAC-BLAKE2s per RFC 2104 with B = 64 (BLAKE2s block size).
/// This is what the Noise Protocol Framework's HMAC-HASH means.
const String hmacBlake2sSecretAbcRef = '38441ee1d037603eb6dbcf66742ebbbcbd8afb9606c178532e0f364bd50b4583';
const String hmacBlake2sKey32AbcRef = '82623be5bc0a391b24dce53e67d028eff92d586de0485ac37822e597d049c74f';
const String hmacBlake2sKey100AbcRef = 'c1b751501db12b753069a918627b623179be55c8cc7ca5c4e14bdf32274ac656';
const Map<int, String> hmacBlake2sKey32Ref = <int, String>{
  0: 'e2641d24dfa8dd89e8cb77f1cdc77d8c006e5bebdfc4d6a3a3a6f8d5b7586fb0',
  1: '1c1dcfc5738194d80021e4d779094a33329e331ab01df5708992d5ce82b50840',
  3: '610b96cb82cced78c0bf13a7a2156e063e8577275ec78b38aca6d97a141c2a12',
  31: '754a10fa337454c8f2840fea5e1fb313d1236d28086ab74c87b5c5aa6b1100d3',
  32: 'a1ca9fd7c76b35d674b159fe84f237871cbfa63f32c2c761ef5e8d91e4820630',
  33: '5b3a74af7f2cf141f469e55b799edf60b384a7d42bca156153a85f7816bdd8ab',
  63: '01acda381cf06bbd2b0596b580ef5cc6f3d96d8e3ef9ac1e004f3900d25c5784',
  64: '3d8dbcd4a30e30b0355dedc73a214249bf61399fac4fdd4a0ee21c1b2dc33667',
  65: 'dd0c9246d1d46dc344f6d01c41b36f028464cd604df2021e16dfde37684d7d2a',
  127: '4c3db4e835342c7434b6cd2c4e28aace87aab50cc3603be76d6441ad60d4a61d',
  128: '3e96071981776d3df25469ea285c2b854e26d2427d62971d02f86cf77e74b5e5',
  129: '7ec5001b1fc5b383a4e32f0e2b9de5617f5e3e617fa4dced559bce86830b63f8',
  255: 'e717cea053c8f1c89e97d151afc0d2af830e1bf3d86d62a9c7838de0e17ba962',
  256: 'dda77b54ad50254cb396f735d0604aa6c114c8bb23acfcb3297491227eff1fd7',
  1000: '6c2695abd82e0c4b08d74f4288b40cffd7da2973f8c4e9c605c83cbe4e213c1c',
};

/// Textbook HMAC-BLAKE2b per RFC 2104 with B = 128 (BLAKE2b block size).
const String hmacBlake2bSecretAbcRef = 'f0eda798c45c704ed9823e24491cf9fb44bfe4d3802cfae6af1e44f274b82bb683c9f0b2446eaa276cb4c06ea46afc848d27711b4609d269b1a4717577cb9552';
/// HMAC emulated with pad block = digest size instead of the real hash block
/// size. These describe the behaviour of package:cryptography's
/// `Hmac(Blake2s())` (B = 32) and `Hmac(Blake2b())` (B = 64).
const String hmacEmulBlake2sB32SecretAbcRef = '773a1d7d24a7d4c742973ad7420fadc143e2ec52a09ffe9c279f367ab8cad85b';
const String hmacEmulBlake2bB64SecretAbcRef = '87b33895c0d474e40289766104f4d02dfd689c0d7a16b3e9796ff8ec3d2a0db8b1fa89267d44a08abb6bd6bf1cdfd320ec41f7ae695f7105296d7bb2f8c642f8';

/// RFC 5869 test-case-1 inputs, hashed with HMAC-BLAKE2s.
const String hkdfIkmHex = '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b';
const String hkdfSaltHex = '000102030405060708090a0b0c';
const String hkdfInfoHex = 'f0f1f2f3f4f5f6f7f8f9';
const String hkdfPrkBlake2sRef = '57e878130679f9ea85900980b52df2643d043b82f290eb7dd62175dbb04cca4e';
const String hkdfOkm32Blake2sRef = '1472c31f2ff768c71b19f8803683ee3b13c1a5fb3ea59c0c3bf0d44a4a40dcd4';
const String hkdfOkm42Blake2sRef = '1472c31f2ff768c71b19f8803683ee3b13c1a5fb3ea59c0c3bf0d44a4a40dcd4329d9cd85bbe35a1b3e7';

/// RFC 5869 HKDF built on the emulated (non-standard, B = 32) HMAC-BLAKE2s,
/// i.e. what package:cryptography's Hkdf(hmac: Hmac.blake2s()) produces.
const String hkdfOkm32EmulBlake2sB32Ref = '7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b6';
const String hkdfOkm42EmulBlake2sB32Ref = '7077bc75410030aa2411651be1df17b17807104e095e479a33e46a60808a83b63f6bb4c1735c585f4235';

/// Noise HKDF(chaining_key, input_key_material) with HASHLEN = 32 (BLAKE2s).
/// No truncation applies because HASHLEN == 32.
const String noiseHkdfCkHex = '4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e';
const String noiseHkdfIkm = 'noise-ikm';
const String noiseHkdfBlake2sO1Ref = 'afad1a49a02abfbf71cc91c5306ee5c57f8f534119886893a986719f7057a4b0';
const String noiseHkdfBlake2sO2Ref = '85f6d91afa3f4247a8e9de7f012df5fe8f0255fc798bff3ea5b12d32d1274140';

/// Same construction with HASHLEN = 64 (BLAKE2b) where Noise discards
/// everything after the first 32 bytes of every HMAC output.
const String noiseHkdfBlake2bTruncO1Ref = 'fdc2492006313006a8899c5140fa804a25fc0503693c4e101474b5433fdb09a3';
const String noiseHkdfBlake2bTruncO2Ref = 'de3fcaf3a1202362e33dde531a02f62cf4e6ef8abbafa8c8e023229806e1511c';
const String noiseHkdfBlake2bFullO1Ref = 'b7a440a75a0056227790c3516b2af9cbd1b70bb446974d8f4daebca5043895f5aaca4bd3c60f1252f67442d490c8094a3c3677429a1aa9bf087f7578ab08586a';

/// SHA-256 digests of pattern(n).
const Map<int, String> sha256Ref = <int, String>{
  0: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  1: 'e7cf46a078fed4fafd0b5e3aff144802b853f8ae459a4f0c14add3314b7cc3a6',
  3: '9bef0e5f2b6e407e1492abfcf729c30cc561f835d2c8b286f3ac14c1406a7672',
  31: 'a929fe91166d70cd70b2fdf38c2d626b1c7f4e6ce2a31a7313ba2966406d9135',
  32: '626c4ed5cb6893c7a708f5d84df0020fd7896a4e1c982e2e4c7ba2b09d084961',
  33: 'da8ad2772558562cd5a4c0cae79a12ba3192d2fde13bf81ee6ff312953e3d0fa',
  63: 'fc8329f49dc58f8564a7e1688ded65f17c92368136e07bc01e5ce2f1ea86d8e9',
  64: '2f4ffe1f17a86fea1f2d35d7b334f246d7e59b443064423329eb3a6c7ff7fbd1',
  65: 'a1e71339bfadd6f8065fcff4c12f2c468cd31b1abf188b73bce5e0fa16f982f3',
  127: 'd4bdc35cb355a74588963ea002629a2e6f81039bee56e3086916a13edb8404e6',
  128: '4b600b3762621ec85ab6a4a727914cfd75ecff3fcde53a7284595588e81679a0',
  129: '112ba1c81ae3f5d41c9aa72f31ec91cf95101050bbe5df04f37a41b5deb61416',
  255: '03b3c3abfad2ebe34473bca856964b696ad32e65f8ba0c02079d474057b68f38',
  256: '960c6ebb735df2ca9f35e74e95630499339444947fc0600da806f3c63217f572',
  1000: 'b5fbc3835f00e2b6501fbcafc8a7fd5d0333b3dab2541a19e2bab10e6377e9d6',
};

/// RFC 8439 section 2.8.2 AEAD_CHACHA20_POLY1305 vector.
const String rfc8439KeyHex = '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f';
const String rfc8439NonceHex = '070000004041424344454647';
const String rfc8439AadHex = '50515253c0c1c2c3c4c5c6c7';
const String rfc8439PlaintextHex = '4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e';
const String rfc8439CiphertextHex = 'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116';
const String rfc8439TagHex = '1ae10b594f09e26a7e902ecbd0600691';

/// Noise 96-bit nonce: 4 zero bytes || LE64(0).
const String noiseNonce0Hex = '000000000000000000000000';
const String noiseCt0Hex = 'fff87813397799dfec8c19a83d3fbe10417e270f127a97ffc33addbcfce5ce3862989f5b414123fb1d97e23c2b232e2becacdd81e85efec5805f1921c28fd39b2ae7540235c087ebba91ae28d6';
const String noiseTag0Hex = 'd69e2bd1f3507c6669a3cde824d7a5a0';
/// Noise 96-bit nonce: 4 zero bytes || LE64(1).
const String noiseNonce1Hex = '000000000100000000000000';
const String noiseCt1Hex = '34ef69e3c5f594916d087474c2672a5c5afd595d82402868b63bc2f9a793d3725c7afa55ddaf75cb91c34dfbbaa985680ecc6e484c98e69b0341cd5f65d8afd6075bd8aa528a2a4351c276da74';
const String noiseTag1Hex = '73240a9e04f95f6cea2cadd7f213d849';
/// Noise 96-bit nonce: 4 zero bytes || LE64(2).
const String noiseNonce2Hex = '000000000200000000000000';
const String noiseCt2Hex = '0eb75dcfcb02153c65afc80c057f1222e777d01eff4abd8b12c7eaef9c23d3640142ec97aae3259b1c2e1ac5d505088bd5421bf1947a916dfaa76d943827d8074495b9ff443f36c31b47385f7d';
const String noiseTag2Hex = '486bf1cb5c9fe9ccd7e7b2eb25f727b3';
/// Noise 96-bit nonce: 4 zero bytes || LE64(72623859790382856).
const String noiseNonce72623859790382856Hex = '000000000807060504030201';
const String noiseCt72623859790382856Hex = '55a0a5f9386c0d840ee67c6bc9f4e79d21cd55cf85eb4340e24ccdef8c43c5f15d93ebed9c75c3e7273c46ca2248b5ef992ecdfbab5c9b5e824af480f2d1feb15581d6ba4a630eaabdccb661ea';
const String noiseTag72623859790382856Hex = 'e6fdc6e1ec135d262b9678f1ab4bda15';
const String noiseAeadKeyHex = '1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c';
const String noiseAeadAadHex = 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';
const String noiseAeadPlaintextHex = '0b121920272e353c434a51585f666d747b828990979ea5acb3bac1c8cfd6dde4ebf2f9050c131a21282f363d444b525960676e757c838a91989fa6adb4bbc2c9d0d7dee5ecf3fa060d141b2229';

