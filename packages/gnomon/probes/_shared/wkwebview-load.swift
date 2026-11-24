// wkwebview-load — shared by the M1.0 browser probes (p09, p12). Loads one URL
// in an offscreen WKWebView (the system WebKit: Safari's engine and the macOS
// Tauri wrapper's WebView) and keeps the run loop alive until the page reports
// to the probe's own loopback server, or until the timeout. Prints one line:
// `wkwebview-load: <status>` and exits 0 on load, 1 on navigation failure,
// 2 on timeout. The page itself carries the measurement; this tool only hosts it.
//
//   swiftc -O wkwebview-load.swift -o wkwebview-load
//   ./wkwebview-load <url> <timeout-seconds>
import AppKit
import WebKit

final class Host: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    init(frame: NSRect) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent() // cold every run, no disk cache
        webView = WKWebView(frame: frame, configuration: config)
        super.init()
        webView.navigationDelegate = self
        Host.keepVisible(webView)
    }
    /// T-2026-11-06-003: an offscreen window is OCCLUDED whenever the display sleeps, the session is locked or the
    /// window server has no screen for it (a hosted CI runner, an agent's background session). WebKit then marks the
    /// page hidden: timers still run, but requestAnimationFrame never fires, so a page that mounts through rAF
    /// (Excalidraw) loads, logs didFinish and never reports. Turning window occlusion detection off makes the page
    /// visible whenever its window is ordered in, which is what WebKit's own test runner does for its offscreen
    /// windows. The selector is WebKit SPI, looked up at run time: where it is missing the host says so and carries on.
    static func keepVisible(_ webView: WKWebView) {
        let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        guard webView.responds(to: sel), let imp = webView.method(for: sel) else {
            print("wkwebview-load: occlusion detection SPI missing (the page may be hidden)")
            fflush(stdout)
            return
        }
        typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
        unsafeBitCast(imp, to: Setter.self)(webView, sel, false)
    }
    /// Printed before a timeout exit: whether the page was hidden and how far its script got (the page's own
    /// report object, if it has one), so a silent run says why.
    func dumpState(_ done: @escaping () -> Void) {
        let js = "JSON.stringify({visibility: document.visibilityState, phase: (window.__board || window.__p12 || window.__p09 || {}).phase || null, mounted: (window.__board || window.__p12 || {}).mounted || false})"
        var finished = false
        webView.evaluateJavaScript(js) { value, error in
            if finished { return }
            finished = true
            print("wkwebview-load: state \(value as? String ?? "unavailable: \(error?.localizedDescription ?? "nil")")")
            fflush(stdout)
            done()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if finished { return }
            finished = true
            print("wkwebview-load: state unavailable (the web process did not answer in 3 s)")
            fflush(stdout)
            done()
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("wkwebview-load: didFinish")
        fflush(stdout)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("wkwebview-load: didFail \(error.localizedDescription)")
        exit(1)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("wkwebview-load: didFailProvisional \(error.localizedDescription)")
        exit(1)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        print("wkwebview-load: webContentProcessTerminated")
        exit(1)
    }
}

let args = CommandLine.arguments
guard args.count >= 2, let url = URL(string: args[1]) else {
    print("usage: wkwebview-load <url> [timeout-seconds]")
    exit(64)
}
let timeout = args.count >= 3 ? (Double(args[2]) ?? 60) : 60

let app = NSApplication.shared
app.setActivationPolicy(.prohibited) // no Dock icon, no menu bar, no focus steal
let frame = NSRect(x: -10000, y: -10000, width: 1280, height: 800)
let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
let host = Host(frame: NSRect(x: 0, y: 0, width: 1280, height: 800))
window.contentView = host.webView
window.orderBack(nil) // offscreen but ordered in; Host.keepVisible stops WebKit hiding the page when the window is occluded
host.webView.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
    host.dumpState {
        print("wkwebview-load: timeout")
        fflush(stdout)
        exit(2)
    }
}
app.run()
