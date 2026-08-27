import UIKit
import WebKit
import AVFoundation

/// Thin WKWebView host. Audio stays in JS; this controller only loads the
/// local (embedded or OTA) bundle, marks the page as a native shell, and
/// forwards lifecycle / OTA messages through the shared bridge.
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
  private var webView: WKWebView!
  private var interruptionObserver: NSObjectProtocol?
  private var embeddedWww: URL?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []

    let bootstrap = WKUserScript(
      source: """
        window.__astropitchNativeShell = true;
        window.__astropitchShellVersion = \(OtaUpdater.shellVersion);
        window.__astropitchNative = window.__astropitchNative || {};
        """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    config.userContentController.addUserScript(bootstrap)
    // JS → native: playing + OTA. Does not expose AVFoundation / filesystem APIs.
    config.userContentController.add(self, name: "astropitch")

    let webView = WKWebView(frame: view.bounds, configuration: config)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    webView.isOpaque = false
    webView.backgroundColor = .black
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(webView)
    self.webView = webView

    embeddedWww = resolveEmbeddedWww()
    loadActiveApp()
    observeAudioInterruptions()
  }

  deinit {
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
    }
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "astropitch")
  }

  private func resolveEmbeddedWww() -> URL? {
    if let www = Bundle.main.url(forResource: "www/index", withExtension: "html") {
      return www.deletingLastPathComponent()
    }
    if let www = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
      return www.deletingLastPathComponent()
    }
    return nil
  }

  private func loadActiveApp() {
    guard let embedded = embeddedWww else {
      NSLog("AstroPitch: www/index.html missing — run native/sync-www.sh")
      return
    }
    let www = OtaUpdater.activeWwwDirectory(embedded: embedded)
    let index = www.appendingPathComponent("index.html")
    webView.loadFileURL(index, allowingReadAccessTo: www)
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
    if let dict = message.body as? [String: Any], dict["ota"] != nil {
      OtaUpdater.handleMessage(message.body, embedded: embeddedWww) { [weak self] dir in
        let index = dir.appendingPathComponent("index.html")
        self?.webView.loadFileURL(index, allowingReadAccessTo: dir)
      }
      return
    }
    // Playing-state ack; reserved for future Now Playing / session work.
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
