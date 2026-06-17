// MermaidWebView.swift — #atrium-visual-canvas
// A sandboxed WKWebView that renders a mermaid diagram OFFLINE using a VENDORED
// mermaid.min.js bundled in Resources/ — NO network. The HTML harness is recolored
// to the ATRIUM (dark) palette. baseURL is nil/bundle so nothing loads remotely.
//
// If the vendored script is missing from the bundle, the view degrades to a plain
// "diagram source" text dump (it never blanks silently).

import SwiftUI
import WebKit

struct MermaidWebView: NSViewRepresentable {
    let mermaid: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // No network, no JS bridges beyond the bundled script.
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground") // transparent → ATRIUM void shows
        webView.navigationDelegate = context.coordinator
        loadDiagram(into: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        loadDiagram(into: webView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Block ALL navigation except the initial in-memory load (defense-in-depth:
    /// no network even if the diagram source tried to inject a link).
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.navigationType == .other {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }
    }

    private func loadDiagram(into webView: WKWebView) {
        guard let scriptURL = ConductorResources.url(forResource: "mermaid.min", withExtension: "js"),
              let script = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            ConductorLog.component("atrium-visual-canvas")
                .error("mermaid.min.js missing from bundle — degrading to source dump")
            let escaped = htmlEscape(mermaid)
            let fallback = "<html><body style=\"background:#0B0E14;color:#8A93A6;font-family:monospace;padding:16px\"><pre>\(escaped)</pre></body></html>"
            webView.loadHTMLString(fallback, baseURL: nil)
            return
        }

        let diagram = htmlEscape(mermaid)
        let html = """
        <!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          html,body { margin:0; padding:0; background:#0B0E14; }
          #wrap { padding:18px; display:flex; justify-content:center; }
          .mermaid { color:#E6EAF2; font-family:ui-monospace,Menlo,monospace; }
        </style>
        <script>\(script)</script>
        </head>
        <body>
          <div id="wrap"><pre class="mermaid">\(diagram)</pre></div>
          <script>
            try {
              mermaid.initialize({
                startOnLoad: true,
                securityLevel: 'strict',
                theme: 'dark',
                themeVariables: {
                  background: '#0B0E14',
                  primaryColor: '#171C28',
                  primaryTextColor: '#E6EAF2',
                  primaryBorderColor: '#222A39',
                  lineColor: '#8A93A6',
                  secondaryColor: '#11151F',
                  tertiaryColor: '#0C0F17',
                  fontFamily: 'ui-monospace, Menlo, monospace'
                }
              });
            } catch (e) { document.body.innerText = 'mermaid error: ' + e; }
          </script>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func htmlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
