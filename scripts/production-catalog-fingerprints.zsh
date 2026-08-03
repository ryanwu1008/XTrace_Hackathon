#!/bin/zsh

# Reviewed on PostgreSQL 17.10 (Homebrew 17.10) and PostgreSQL 17.6
# (the pinned postgres:17.6 image matching the audited Supabase server). The
# catalog manifest includes server_version_num, so any other point release fails
# closed instead of silently inheriting either attestation.
readonly VSEE_CATALOG_PROTOTYPE="sha256:4bf140da8f16833fe281350626186538b3005bd2eb0475efc1ae16028393fe66"
readonly VSEE_CATALOG_0007="sha256:0594ed75ae7ac05be2f020bbcbf53f46542ab941a21b46a09c6a836418b3e1fd"
readonly VSEE_CATALOG_BRIDGED_0007="sha256:0be1555cb741812763f052583badc8897e695e3dcf53e922c6b0c3cf822b52d9"
readonly VSEE_CATALOG_0008="sha256:a0651d319b7fcdb2a0fc3bd4fabd78df76b02864765b8fdbea1f39aa049c1bbc"
readonly VSEE_CATALOG_BRIDGED_0008="sha256:a140ab0a826760a75b59b7c3abc2611ba9197c02e78191f2ab6e730d1ae0cd9a"
readonly VSEE_CATALOG_0009="sha256:57630cecd5f43fc9142dc458bbc0438dedcec488a6100e70e231d8f30b443a71"
readonly VSEE_CATALOG_BRIDGED_0009="sha256:e9eb1a277ed700fc7c3cf3f9b395d48f59d413c60bcb0e125335df593f20e775"
readonly VSEE_CATALOG_0011="sha256:0ad077b8be0863b81358ccf9d2f90e6865ae60c325b5f2f03a678dba16ed82b1"
readonly VSEE_CATALOG_BRIDGED_0011="sha256:7450461f49b0e0b5ca1777c791d656fb5f91230c02f506d598c4dd986f084ac7"
readonly VSEE_CATALOG_0012="sha256:d9ad15e28783940b157d6f081c037552734db2a3c750f7146940cdb6cb80c553"
readonly VSEE_CATALOG_BRIDGED_0012="sha256:ec9a5eb5343551eecda89720a1ba92a4575dce3cebeb6c4780ec6dd2f7740360"
readonly VSEE_CATALOG_0013="sha256:669771fec8a06046416ad4457797e0c2914fcd6c4bcbb3491ca091bf158d21da"
readonly VSEE_CATALOG_BRIDGED_0013="sha256:8198ce22dad1d3b3c21919fc82a84fa99d4c481372e48fb19062c8899371ca4d"
readonly VSEE_CATALOG_0016="sha256:05ef54368e60b9f6145ea12362672d10ae9adfc286b5c5dcf678b0ae14eba2b9"
readonly VSEE_CATALOG_BRIDGED_0016="sha256:96ee13974983a9fa4c93e125a68d181a5e99538d287edfd14321d40d8ddcfb3a"
readonly VSEE_CATALOG_0017="sha256:66f64e9dd0ff9b7eba582957bb6949e92f700c046f19ccd20b07aba0aa76c86c"
readonly VSEE_CATALOG_BRIDGED_0017="sha256:0bb982fe4c99a7eab553c937ac117e089b1cd5b3e8ae9e5108286f519b5f575a"

readonly VSEE_CATALOG_PG176_PROTOTYPE="sha256:c5b9d1a84911bda621f472906b4f058a3e477d860cd732fc8893aba706ce5cad"
# Supabase grants redundant, non-grantable USAGE on public to its API roles
# and postgres. This attestation differs from the plain PG17.6 prototype only
# in those three raw schema ACL entries; effective schema privileges and every
# application-owned object remain identical.
readonly VSEE_CATALOG_PG176_SUPABASE_PROTOTYPE="sha256:9d54dddfadf68c2a72e1247b182a1998940aadd9110816a63b6c9529835fb3e1"
readonly VSEE_CATALOG_PG176_SUPABASE_0007="sha256:b2a5465d23e7109638270b72247040060b5f54f16f8846a9bca08a86ebc62f25"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0007="sha256:cc390fa7000e1e85d73c601ec5cef8fd0eb83a5d4ccbb11da3c9a94ebe9fa684"
readonly VSEE_CATALOG_PG176_SUPABASE_0008="sha256:20b525eb134e2e8726e21f60a52e531d935b4c739824bcfd5f06421bfa696443"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0008="sha256:c63910c08ee882fee34c23d160438341d81f704d7a193e976e1d27b2255084c6"
readonly VSEE_CATALOG_PG176_SUPABASE_0009="sha256:4803b01b5b526660faa0059071360c709209c83587edb5bd719c4b855dd2638b"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0009="sha256:81fddccc188a6e8ee276be9edf39aa41c95309a252f7e37815946f1a2bcef3c1"
readonly VSEE_CATALOG_PG176_SUPABASE_0011="sha256:8e77cd04a9b1dd99d9ee3f2c6fdc26728d5bf0298656e1eae85880bce238efe8"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0011="sha256:70025e158b23b4763bf214d552e62dd2308d5df3d0e826281769605104c5500c"
readonly VSEE_CATALOG_PG176_SUPABASE_0012="sha256:c6e3f7cadea15a856b6dc35d7d48c02e43eac29b9c70fa458d64fd1aaec08373"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0012="sha256:dd6e0a421ef0f7268250bcfaf2ce8ffacce436f9d80cdd432a7fc3282a8aadc2"
readonly VSEE_CATALOG_PG176_SUPABASE_0013="sha256:0e678aa2e48b6844737ff6f634aad82a673d24e7fabee74c99fd9ced4b7dcb97"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0013="sha256:b6cab17c34755d2f4c05ec408cca8385b5047e293090d79fd789d64125e8fe97"
readonly VSEE_CATALOG_PG176_SUPABASE_0016="sha256:3c8dc4ad0a220168d82cee65f26b2478c7584da7e3a28b9e4dfb35832ee196f1"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0016="sha256:11d6772d9972dc93958c1faa732fc1c5f814cf3e746558dd539cc11774f729a7"
readonly VSEE_CATALOG_PG176_SUPABASE_0017="sha256:471ca93e9532dcde79d963cf8de7520fe1f0d4569e14a57a7830654483956daf"
readonly VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0017="sha256:f7d0fb4869aff4c12b24a05cd5b637b684846182f20b4363bf83c816337bebbe"
# Supabase's production migration executor is a non-superuser with CREATEROLE.
# PostgreSQL 17 records an immutable bootstrap-admin membership for each owner
# role it creates, so this profile is distinct from an administrator-run
# Supabase catalog from migration 0009 onward.
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0009="sha256:d72fcf58d6ac83fad33ff74fcc62dcd475ea1894bfcee99d5ac6f9ee82e4a81b"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009="sha256:15d4475110a5425162e246a0b33a547f33b8550d1e0327c92f67de9db8f1071e"
# A repair-only fingerprint captured after the first production 0009 run.
# It differs from the reviewed bridged boundary only by Supabase's explicit
# default EXECUTE grants on five 0009 functions. It is intentionally excluded
# from vsee_catalog_variant and every migration-stage matcher.
readonly VSEE_REPAIRABLE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009_DEFAULT_FUNCTION_ACL="sha256:a5e1729c32fbe1a99a0487ce7a11701e23d09dc4c201fece540967101565591c"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0011="sha256:cabc34dd16625eb8f12319b220aabc0e6ad07309592f31562faaab5ce869f842"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0011="sha256:cb889785eb64b9a44940c36aef4875938f2d2c4382cd0da3927919de3d43c9cf"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0012="sha256:9b52be35bf23b6342b8fd55845617cb6cec8b436cc9963dbd1c2cce6e67686b4"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0012="sha256:9d782b4e6480f9b527b21d265a0b7d6d3d6df75f278bbadb1c4e383bcff92cd8"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0013="sha256:d030330d3ffd1966da82a191e9336bc22a898e4eec4d9bc8ba0926ee58f2546b"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0013="sha256:8695f2cbfb93bcf9d9b5dc88597905e2f40c038fe57cc03fbf65b009b60bbc36"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0016="sha256:c7cc3de50496a8b96eb69d3566a5aa00a44eb9458ba456c20a391fdeab2467b1"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0016="sha256:b61191ee0055b6b20a0401d6f18f2ccb71b6013fe9f84215eddc7c4f8d658c12"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0017="sha256:71ad64d173081f801cbe205c246e86756127b37028c054bb1c1d2321ee752ede"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0017="sha256:1e96ca563d4e38886ec7b4059b09270c8a7b8125074ab563ce07a898c1641bd3"
readonly VSEE_CATALOG_PG176_0007="sha256:0fa88731f4b1a914e59b7188640b091d5b7f37efd98b49e908c852eacd48bd57"
readonly VSEE_CATALOG_PG176_BRIDGED_0007="sha256:bf1e16882f7ed5df4758a8f4c0029f6801cafe59ba7042247ca2476b8d43d1e8"
readonly VSEE_CATALOG_PG176_0008="sha256:122b735ebd36705b0666996a049678b3b33ec30e8f07a44f585b3266fb433040"
readonly VSEE_CATALOG_PG176_BRIDGED_0008="sha256:1837e5b813404bfba94514595566804f276beca9a9f278a419a9ebb622366a4f"
readonly VSEE_CATALOG_PG176_0009="sha256:0f10ecd790dd989baf65187ea1eb7b76432bdce4f764b90bbfe22117b7c8623e"
readonly VSEE_CATALOG_PG176_BRIDGED_0009="sha256:45a80a85d4a8e13a5e087671b20304e10fed7daa33154d9c11e200b44c467aa2"
readonly VSEE_CATALOG_PG176_0011="sha256:1b642e46b6961710d8f9181ce5a537b27720737e7cda36e3402f592c56913d0a"
readonly VSEE_CATALOG_PG176_BRIDGED_0011="sha256:fa1fef8dd5983206d9821d265c54663284265eebd8f8f95381989bbd95b9b7c3"
readonly VSEE_CATALOG_PG176_0012="sha256:9fad7fc4b8ccaf53f5c5d01535f43a0b0a34c9dcf250272d3631fe0d09eaecc7"
readonly VSEE_CATALOG_PG176_BRIDGED_0012="sha256:e48459ba42159375a4f478690bef69d0437482714d832f27a7ef192d1cbc4f9e"
readonly VSEE_CATALOG_PG176_0013="sha256:155dc8ba2f7c2b4808910af67a4cab059dde949bb3752e54a07e5a04c37af4cc"
readonly VSEE_CATALOG_PG176_BRIDGED_0013="sha256:7b91a25684c3f47c307ba7804d0cb0b24d43b7982a574534b45d1f1a22596624"
readonly VSEE_CATALOG_PG176_0016="sha256:7c4f0ac11d90e3ba8602b19cff3ca212a4dbfc81b79bd0541a4cdeb1d7c0a202"
readonly VSEE_CATALOG_PG176_BRIDGED_0016="sha256:d9749609197b04d479b767408ffff881f68d50ad29dbd803e4561fb5155d63b4"
readonly VSEE_CATALOG_PG176_0017="sha256:e3d0358049556d56faa922d481b512b01964784778710efcbe5a749da8000a89"
readonly VSEE_CATALOG_PG176_BRIDGED_0017="sha256:786e4ef58412f7016a6934f453b284c0c3c0dc621438eb06ff535857e102e097"

vsee_repairable_catalog_variant() {
  case "$1" in
    "$VSEE_REPAIRABLE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009_DEFAULT_FUNCTION_ACL")
      print -- "0009-bridged-lineage-supabase-createrole-pg17.6-default-function-acl"
      ;;
    *) return 1 ;;
  esac
}

vsee_catalog_variant() {
  case "$1" in
    "$VSEE_CATALOG_PG176_SUPABASE_PROTOTYPE") print -- "prototype-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0007") print -- "0007-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0007") print -- "bridged-0007-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0008") print -- "0008-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0008") print -- "bridged-0008-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0009") print -- "0009-current-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0009") print -- "0009-bridged-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0011") print -- "0011-current-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0011") print -- "0011-bridged-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0012") print -- "0012-current-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0012") print -- "0012-bridged-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0013") print -- "0013-current-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0013") print -- "0013-bridged-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0016") print -- "0016-current-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0016") print -- "0016-bridged-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_0017") print -- "0017-current-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0017") print -- "0017-bridged-lineage-supabase-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0009") print -- "0009-current-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009") print -- "0009-bridged-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0011") print -- "0011-current-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0011") print -- "0011-bridged-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0012") print -- "0012-current-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0012") print -- "0012-bridged-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0013") print -- "0013-current-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0013") print -- "0013-bridged-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0016") print -- "0016-current-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0016") print -- "0016-bridged-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0017") print -- "0017-current-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0017") print -- "0017-bridged-lineage-supabase-createrole-pg17.6" ;;
    "$VSEE_CATALOG_PROTOTYPE"|"$VSEE_CATALOG_PG176_PROTOTYPE") print -- "prototype" ;;
    "$VSEE_CATALOG_0007"|"$VSEE_CATALOG_PG176_0007") print -- "0007" ;;
    "$VSEE_CATALOG_BRIDGED_0007"|"$VSEE_CATALOG_PG176_BRIDGED_0007") print -- "bridged-0007" ;;
    "$VSEE_CATALOG_0008"|"$VSEE_CATALOG_PG176_0008") print -- "0008" ;;
    "$VSEE_CATALOG_BRIDGED_0008"|"$VSEE_CATALOG_PG176_BRIDGED_0008") print -- "bridged-0008" ;;
    "$VSEE_CATALOG_0009"|"$VSEE_CATALOG_PG176_0009") print -- "0009-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0009"|"$VSEE_CATALOG_PG176_BRIDGED_0009") print -- "0009-bridged-lineage" ;;
    "$VSEE_CATALOG_0011"|"$VSEE_CATALOG_PG176_0011") print -- "0011-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0011"|"$VSEE_CATALOG_PG176_BRIDGED_0011") print -- "0011-bridged-lineage" ;;
    "$VSEE_CATALOG_0012"|"$VSEE_CATALOG_PG176_0012") print -- "0012-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0012"|"$VSEE_CATALOG_PG176_BRIDGED_0012") print -- "0012-bridged-lineage" ;;
    "$VSEE_CATALOG_0013"|"$VSEE_CATALOG_PG176_0013") print -- "0013-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0013"|"$VSEE_CATALOG_PG176_BRIDGED_0013") print -- "0013-bridged-lineage" ;;
    "$VSEE_CATALOG_0016"|"$VSEE_CATALOG_PG176_0016") print -- "0016-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0016"|"$VSEE_CATALOG_PG176_BRIDGED_0016") print -- "0016-bridged-lineage" ;;
    "$VSEE_CATALOG_0017"|"$VSEE_CATALOG_PG176_0017") print -- "0017-current-lineage" ;;
    "$VSEE_CATALOG_BRIDGED_0017"|"$VSEE_CATALOG_PG176_BRIDGED_0017") print -- "0017-bridged-lineage" ;;
    *) return 1 ;;
  esac
}

vsee_catalog_matches_stage() {
  local stage="$1"
  local fingerprint="$2"
  case "$stage" in
    prototype)
      [[ "$fingerprint" == "$VSEE_CATALOG_PROTOTYPE" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_PROTOTYPE" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_PROTOTYPE" ]]
      ;;
    0007)
      [[ "$fingerprint" == "$VSEE_CATALOG_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0007" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0007" ]]
      ;;
    0008)
      [[ "$fingerprint" == "$VSEE_CATALOG_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0008" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0008" ]]
      ;;
    0009|0010)
      [[ "$fingerprint" == "$VSEE_CATALOG_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0009" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009" ]]
      ;;
    0011)
      [[ "$fingerprint" == "$VSEE_CATALOG_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0011" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0011" ]]
      ;;
    0012)
      [[ "$fingerprint" == "$VSEE_CATALOG_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0012" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0012" ]]
      ;;
    0013|0014|0015)
      [[ "$fingerprint" == "$VSEE_CATALOG_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0013" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0013" ]]
      ;;
    0016)
      [[ "$fingerprint" == "$VSEE_CATALOG_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0016" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0016" ]]
      ;;
    0017|0018)
      [[ "$fingerprint" == "$VSEE_CATALOG_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_BRIDGED_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_BRIDGED_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0017" \
        || "$fingerprint" == "$VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0017" ]]
      ;;
    *) return 1 ;;
  esac
}

# 0019 intentionally remains closed until its exact PostgreSQL 17.6 Supabase
# and CREATEROLE profile manifests have been generated and reviewed. Never
# alias a catalog-changing migration to the 0017/0018 constants.
vsee_catalog_stage_is_reviewed() {
  [[ "$1" != "0019" ]]
}
