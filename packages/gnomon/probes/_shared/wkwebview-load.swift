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
window.orderBack(nil) // offscreen but ordered in, so WebKit does not throttle timers/rAF
host.webView.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
    print("wkwebview-load: timeout")
    exit(2)
}
app.run()
