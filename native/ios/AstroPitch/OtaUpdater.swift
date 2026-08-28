import Foundation
import CryptoKit

/// Downloads, hash-verifies, and atomically swaps versioned web bundles.
/// Web assets only — never touches native binaries (Phase 5 OTA carve-out).
enum OtaUpdater {
  static let shellVersion = 1

  /// Every path below is built from this, so excluding the directory here is
  /// enough — downloaded bundles are re-downloadable content and Apple's Data
  /// Storage Guidelines say that must not be backed up to iCloud.
  private static var root: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    var dir = base.appendingPathComponent("ota", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    return dir
  }

  private static var stateURL: URL { root.appendingPathComponent("state.json") }

  struct State: Codable {
    var current: String?
    var previous: String?
  }

  struct ManifestFile: Decodable {
    let path: String
    let sha256: String
  }

  struct Manifest: Decodable {
    let schemaVersion: Int
    let bundleVersion: String
    let minShellVersion: Int?
    let baseUrl: String
    let files: [ManifestFile]
  }

  static func activeWwwDirectory(embedded: URL) -> URL {
    let state = loadState()
    guard let current = state.current else { return embedded }
    let dir = root.appendingPathComponent("versions/\(current)", isDirectory: true)
    let index = dir.appendingPathComponent("index.html")
    if FileManager.default.fileExists(atPath: index.path) { return dir }
    return embedded
  }

  static func handleMessage(_ body: Any, embedded: URL?, reload: @escaping (URL) -> Void) {
    guard let dict = body as? [String: Any], let ota = dict["ota"] as? String else { return }
    switch ota {
    case "apply":
      guard let manifestObj = dict["manifest"] else { return }
      do {
        let data = try JSONSerialization.data(withJSONObject: manifestObj)
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        Task {
          do {
            let dir = try await apply(manifest: manifest)
            await MainActor.run { reload(dir) }
          } catch {
            NSLog("AstroPitch OTA apply failed: \(error.localizedDescription)")
          }
        }
      } catch {
        NSLog("AstroPitch OTA manifest decode failed: \(error.localizedDescription)")
      }
    case "rollback":
      do {
        if let dir = try rollback(embeddedFallback: embedded) {
          reload(dir)
        }
      } catch {
        NSLog("AstroPitch OTA rollback failed: \(error.localizedDescription)")
      }
    default:
      break
    }
  }

  static func apply(manifest: Manifest) async throws -> URL {
    if (manifest.minShellVersion ?? 1) > shellVersion {
      throw OtaError.shellTooOld
    }
    guard manifest.schemaVersion == 1 else { throw OtaError.badManifest }
    guard !manifest.bundleVersion.isEmpty else { throw OtaError.badManifest }

    let pending = root.appendingPathComponent("pending/\(manifest.bundleVersion)", isDirectory: true)
    let fm = FileManager.default
    try? fm.removeItem(at: pending)
    try fm.createDirectory(at: pending, withIntermediateDirectories: true)

    let base = manifest.baseUrl.hasSuffix("/") ? manifest.baseUrl : manifest.baseUrl + "/"
    for file in manifest.files {
      guard isSafeRelativePath(file.path) else { throw OtaError.badPath(file.path) }
      guard let url = URL(string: base + file.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)
      else { throw OtaError.badPath(file.path) }
      let (data, response) = try await URLSession.shared.data(from: url)
      if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        throw OtaError.http(http.statusCode)
      }
      let digest = SHA256.hash(data: data)
      let hex = digest.map { String(format: "%02x", $0) }.joined()
      guard hex == file.sha256.lowercased() else { throw OtaError.hashMismatch(file.path) }
      let dest = pending.appendingPathComponent(file.path)
      try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: dest, options: .atomic)
    }

    let final = root.appendingPathComponent("versions/\(manifest.bundleVersion)", isDirectory: true)
    try? fm.removeItem(at: final)
    try fm.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
    try fm.moveItem(at: pending, to: final)

    var state = loadState()
    if let cur = state.current, cur != manifest.bundleVersion {
      state.previous = cur
    }
    state.current = manifest.bundleVersion
    try saveState(state)
    return final
  }

  static func rollback(embeddedFallback: URL?) throws -> URL? {
    var state = loadState()
    guard let prev = state.previous else {
      state.current = nil
      state.previous = nil
      try saveState(state)
      return embeddedFallback
    }
    let dir = root.appendingPathComponent("versions/\(prev)", isDirectory: true)
    let index = dir.appendingPathComponent("index.html")
    guard FileManager.default.fileExists(atPath: index.path) else {
      state.current = nil
      state.previous = nil
      try saveState(state)
      return embeddedFallback
    }
    let failed = state.current
    state.current = prev
    state.previous = failed
    try saveState(state)
    return dir
  }

  private static func loadState() -> State {
    guard let data = try? Data(contentsOf: stateURL),
          let state = try? JSONDecoder().decode(State.self, from: data)
    else { return State(current: nil, previous: nil) }
    return state
  }

  private static func saveState(_ state: State) throws {
    let data = try JSONEncoder().encode(state)
    try data.write(to: stateURL, options: .atomic)
  }

  private static func isSafeRelativePath(_ path: String) -> Bool {
    !path.isEmpty && !path.contains("..") && !path.hasPrefix("/") && !path.contains("\\")
  }

  enum OtaError: Error {
    case shellTooOld
    case badManifest
    case badPath(String)
    case http(Int)
    case hashMismatch(String)
  }
}
