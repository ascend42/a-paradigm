// ConductorResources.swift — #conductor-app
// Resource lookup that resolves THIS module's bundled assets WITHOUT touching the
// SwiftPM-generated `Bundle.module` accessor — which collides with a dependency
// (SwiftTerm also declares `Bundle.module`, making the bare name ambiguous). We
// locate the package's resource bundle by name relative to the main bundle and the
// executable, falling back through the candidates. Used to load the VENDORED
// OFFLINE mermaid.min.js for the LIGHTBOX (#atrium-visual-canvas) — NO network.

import Foundation

enum ConductorResources {

    /// Find a bundled resource by name + extension across the candidate bundles.
    static func url(forResource name: String, withExtension ext: String) -> URL? {
        for bundle in candidateBundles() {
            if let url = bundle.url(forResource: name, withExtension: ext) {
                return url
            }
        }
        return nil
    }

    /// Marker class so `Bundle(for:)` resolves the bundle CONTAINING this code
    /// (the .app in a packaged build; the xctest/exe bundle under .build otherwise).
    private final class Marker {}

    /// The SwiftPM resource bundle name for this target.
    private static let resourceBundleName = "Conductor_Conductor.bundle"

    /// Bundles to probe, in order. We resolve `Conductor_Conductor.bundle` (where the
    /// vendored mermaid.min.js lives) without relying on the generated `Bundle.module`
    /// symbol, which is AMBIGUOUS at the call site (SwiftTerm also declares it). We
    /// probe: every already-loaded bundle whose URL ends in the resource bundle name,
    /// then the nested resource bundle of the module + main + ALL loaded bundles, then
    /// the directory CONTAINING the module bundle (covers the .build/.../release layout
    /// where the .bundle is a sibling of the xctest/exe bundle).
    private static func candidateBundles() -> [Bundle] {
        var out: [Bundle] = []
        var seen = Set<String>()
        func add(_ b: Bundle?) {
            guard let b, seen.insert(b.bundleURL.path).inserted else { return }
            out.append(b)
        }

        let module = Bundle(for: Marker.self)
        let hosts = [module, .main] + Bundle.allBundles + Bundle.allFrameworks

        // 1) Any loaded bundle that already IS the resource bundle.
        for b in hosts where b.bundleURL.lastPathComponent == resourceBundleName {
            add(b)
        }
        // 2) Resource bundles nested inside, or sitting beside, each host bundle.
        for host in hosts {
            // Nested under Contents/Resources (packaged .app layout).
            if let url = host.resourceURL?.appendingPathComponent(resourceBundleName) {
                add(Bundle(url: url))
            }
            // Sibling of the host bundle (the .build/.../release layout).
            let sibling = host.bundleURL.deletingLastPathComponent()
                .appendingPathComponent(resourceBundleName)
            add(Bundle(url: sibling))
        }
        // 3) The host bundles themselves (resource declared directly, no sub-bundle).
        add(module)
        add(.main)
        return out
    }
}
