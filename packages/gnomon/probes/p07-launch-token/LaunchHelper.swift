// p07 launch hand-off stand-in for the signed helper (§11.2 rule 2, browser on
// macOS): reads ONE JSON line on stdin {"url": "...#launch=<token>&k=...",
// "app": "/Applications/Safari.app"} and hands the URL to LaunchServices with
// NSWorkspace.open — delivered to the browser as a GetURL Apple Event, never on
// a command line. The token therefore never touches this process's argv or env.
// Prints {"ok":true|false,...} (never the URL) and exits.
//   xcrun swiftc -O LaunchHelper.swift -o launch-helper
import AppKit
import Foundation

func emit(_ d: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit((d["ok"] as? Bool) == true ? 0 : 1)
}

guard let line = readLine(strippingNewline: true),
      let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
      let s = obj["url"] as? String, let url = URL(string: s) else {
    emit(["ok": false, "error": "expected one JSON line {url, app?} on stdin"])
}
let config = NSWorkspace.OpenConfiguration()
config.activates = true
let done = DispatchSemaphore(value: 0)
var result: [String: Any] = [:]
let handler: (NSRunningApplication?, Error?) -> Void = { app, err in
    result = ["ok": err == nil, "app": app?.bundleIdentifier ?? NSNull(), "pid": app.map { Int($0.processIdentifier) } ?? NSNull(), "error": err.map { "\($0)" } ?? NSNull()]
    done.signal()
}
if let appPath = obj["app"] as? String {
    NSWorkspace.shared.open([url], withApplicationAt: URL(fileURLWithPath: appPath), configuration: config, completionHandler: handler)
} else {
    NSWorkspace.shared.open(url, configuration: config, completionHandler: handler)
}
if done.wait(timeout: .now() + 60) == .timedOut { emit(["ok": false, "error": "LaunchServices did not answer in 60 s"]) }
emit(result)
