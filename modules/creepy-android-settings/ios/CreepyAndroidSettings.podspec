Pod::Spec.new do |s|
  s.name           = 'CreepyAndroidSettings'
  s.version        = '0.1.0'
  s.summary        = 'Android Settings bridge for Creepy.IM (Android only).'
  s.description    = 'Provides access to Android Settings via Expo Modules API. Unsupported on iOS.'
  s.author         = 'Creepy.IM'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
