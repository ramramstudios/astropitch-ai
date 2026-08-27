import UIKit
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Activate the playback session BEFORE the WebView loads. Cold-start
    // stutter in WKWebView is almost always the route warming up mid-note.
    Self.activatePlaybackSession()

    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = WebViewController()
    window.makeKeyAndVisible()
    self.window = window
    return true
  }

  static func activatePlaybackSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .default, options: [])
      try session.setActive(true, options: [])
    } catch {
      NSLog("AstroPitch: AVAudioSession activation failed: \(error)")
    }
  }

  func applicationDidEnterBackground(_ application: UIApplication) {
    (window?.rootViewController as? WebViewController)?
      .postNativeEvent("background")
  }

  func applicationWillEnterForeground(_ application: UIApplication) {
    Self.activatePlaybackSession()
    (window?.rootViewController as? WebViewController)?
      .postNativeEvent("foreground")
  }
}
