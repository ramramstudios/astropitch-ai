import UIKit
import WebKit
import AVFoundation

/// Thin WKWebView host. Audio stays in JS; this controller only loads the
/// local bundle, marks the page as a native shell, and forwards lifecycle
/// events into `window.__astropitchNative.dispatch(...)`.
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
  private var webView: WKWebView!
  private var interruptionObserver: NSObjectProtocol?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []

    let bootstrap = WKUserScript(
      source: """
        window.__astropitchNativeShell = true;
        window.__astropitchNative = window.__astropitchNative || {};
        """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    config.userContentController.addUserScript(bootstrap)
    // JS → native: playing state only. Does not expose AVFoundation to the page.
    config.userContentController.add(self, name: "astropitch")

    let webView = WKWebView(frame: view.bounds, configuration: config)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    webView.isOpaque = false
    webView.backgroundColor = .black
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(webView)
    self.webView = webView

    loadBundledApp()
    observeAudioInterruptions()
  }

  deinit {
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
    }
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "astropitch")
  }

  private func loadBundledApp() {
    guard let www = Bundle.main.url(forResource: "www/index", withExtension: "html")
            ?? Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www")
    else {
      NSLog("AstroPitch: www/index.html missing — run native/sync-www.sh")
      return
    }
    webView.loadFileURL(www, allowingReadAccessTo: www.deletingLastPathComponent())
  }

  private func observeAudioInterruptions() {
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      guard
        let info = notification.userInfo,
        let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
        let type = AVAudioSession.InterruptionType(rawValue: typeValue)
      else { return }

      switch type {
      case .began:
        self?.postNativeEvent("interrupt")
      case .ended:
        AppDelegate.activatePlaybackSession()
        self?.postNativeEvent("foreground")
      @unknown default:
        break
      }
    }
  }

  /// Inject a lifecycle event into the shared JS bridge.
  func postNativeEvent(_ type: String) {
    let js = "window.__astropitchNative && window.__astropitchNative.dispatch({ type: '\(type)' });"
    webView?.evaluateJavaScript(js, completionHandler: nil)
  }

  // MARK: - WKScriptMessageHandler

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "astropitch" else { return }
    // Playing-state ack only; reserved for future Now Playing / session work.
    // The ~27 s WKWebView freeze still applies — Phase 2 rebuild-on-resume
    // is the real answer for background survival.
    _ = message.body
  }

  // MARK: - WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    // Keep navigation inside the bundled app; open external links outside.
    if let url = navigationAction.request.url,
       url.isFileURL || url.scheme == "about" {
      decisionHandler(.allow)
      return
    }
    if let url = navigationAction.request.url {
      UIApplication.shared.open(url)
    }
    decisionHandler(.cancel)
  }
}
