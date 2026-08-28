/**
 * The iOS shell has several facts that live in more than one file and are
 * coupled only by hand: three copies of the version string, two copies of the
 * shell version, and a set of Info.plist keys whose absence or wrong value
 * costs a review cycle rather than failing a build. Nothing here needs Xcode —
 * these are text and plist assertions about the committed project, which is
 * the only part of the iOS build this repo can verify on its own.
 *
 * Not covered: whether the project actually compiles, archives, or launches.
 * That needs Xcode 26 on a machine with the iOS SDK (see native/ios/README.md).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const IOS = ['native', 'ios', 'AstroPitch'];

/**
 * Enough of an XML plist reader for flat key/value assertions: returns
 * '<true/>' / '<false/>' for booleans, the text for strings, and the raw inner
 * XML for arrays and dicts. Deliberately not a general parser — a real one
 * would be a dependency, and this repo has none.
 */
function plistValue(xml, key) {
  const at = xml.indexOf(`<key>${key}</key>`);
  if (at < 0) return null;
  const rest = xml.slice(at + `<key>${key}</key>`.length);
  const m = rest.match(/^\s*(<(true|false)\/>|<string>([\s\S]*?)<\/string>|<(array|dict)>([\s\S]*?)<\/\4>|<array\/>)/);
  if (!m) return null;
  if (m[2]) return `<${m[2]}/>`;
  if (m[3] !== undefined) return m[3];
  if (m[5] !== undefined) return m[5];
  return '';
}

const infoPlist = read(...IOS, 'Info.plist');
const bundle = JSON.parse(read('bundle.json'));

console.log('--- the three version strings stay in lockstep ---');
{
  // OTA policy compares bundle.json against the remote manifest, so drift
  // between it and the binary means the app either re-downloads what it has
  // or refuses a real update. CACHE_NAME is the third hand-maintained copy.
  const short = plistValue(infoPlist, 'CFBundleShortVersionString');
  ok('CFBundleShortVersionString parses', typeof short === 'string' && short.length > 0, String(short));
  ok('bundle.json bundleVersion equals CFBundleShortVersionString',
    bundle.bundleVersion === short, `${bundle.bundleVersion} vs ${short}`);

  const cacheName = read('sw.js').match(/const CACHE_NAME = '([^']+)'/)?.[1];
  ok('sw.js CACHE_NAME carries the same version',
    cacheName === `astropitch-${short}`, `${cacheName} vs astropitch-${short}`);

  // The build number is separate and must stay an integer App Store Connect
  // can order monotonically.
  const build = plistValue(infoPlist, 'CFBundleVersion');
  ok('CFBundleVersion is an integer', /^\d+$/.test(build), build);
}

console.log('--- the shell version is the same number on both sides of the bridge ---');
{
  const swiftVersion = read(...IOS, 'OtaUpdater.swift')
    .match(/static let shellVersion = (\d+)/)?.[1];
  const injected = read(...IOS, 'WebViewController.swift')
    .match(/__astropitchShellVersion = \\\(([^)]+)\)/)?.[1];
  ok('OtaUpdater declares a shellVersion', !!swiftVersion, String(swiftVersion));
  ok('WebViewController injects OtaUpdater.shellVersion',
    injected === 'OtaUpdater.shellVersion', String(injected));
  ok('bundle.json shellVersion matches the Swift constant',
    String(bundle.shellVersion) === swiftVersion, `${bundle.shellVersion} vs ${swiftVersion}`);
}

console.log('--- Info.plist: the keys that cost a review cycle ---');
{
  ok('parses as XML with a plist root',
    /^<\?xml/.test(infoPlist.trim()) && infoPlist.includes('<plist version="1.0">')
      && infoPlist.trimEnd().endsWith('</plist>'));

  // An empty UILaunchStoryboardName sends UIKit into a legacy compatibility
  // mode that computes the wrong screen size and letterboxes the app.
  ok('uses the modern UILaunchScreen dictionary', plistValue(infoPlist, 'UILaunchScreen') !== null);
  ok('launch screen names the LaunchBackground colour set',
    (plistValue(infoPlist, 'UILaunchScreen') ?? '').includes('<string>LaunchBackground</string>'));
  ok('the legacy storyboard key is gone',
    !infoPlist.includes('<key>UILaunchStoryboardName</key>'));

  // armv7 is 32-bit; no iOS device has shipped with it in a decade.
  ok('no armv7 device requirement', !infoPlist.includes('armv7'));

  // Without this every upload lands flagged "Missing Compliance".
  ok('ITSAppUsesNonExemptEncryption is false',
    plistValue(infoPlist, 'ITSAppUsesNonExemptEncryption') === '<false/>');

  // Phase 0.1 branch two: background audio does not survive on WKWebView, and
  // declaring a mode the app does not use is a 2.5.4 rejection.
  ok('no UIBackgroundModes', plistValue(infoPlist, 'UIBackgroundModes') === null);

  ok('LSRequiresIPhoneOS is true', plistValue(infoPlist, 'LSRequiresIPhoneOS') === '<true/>');
}

console.log('--- privacy manifest says nothing is collected ---');
{
  const path = join(root, ...IOS, 'PrivacyInfo.xcprivacy');
  ok('PrivacyInfo.xcprivacy exists', existsSync(path));
  const privacy = readFileSync(path, 'utf8');
  ok('NSPrivacyTracking is false', plistValue(privacy, 'NSPrivacyTracking') === '<false/>');
  ok('no tracking domains', plistValue(privacy, 'NSPrivacyTrackingDomains') === '');
  ok('no collected data types', plistValue(privacy, 'NSPrivacyCollectedDataTypes') === '');
  ok('no required-reason APIs', plistValue(privacy, 'NSPrivacyAccessedAPITypes') === '');
}

console.log('--- the Xcode project is committed and shaped the way the shell needs ---');
{
  const pbxPath = join(root, 'native', 'ios', 'AstroPitch.xcodeproj', 'project.pbxproj');
  ok('project.pbxproj exists', existsSync(pbxPath));
  const pbx = readFileSync(pbxPath, 'utf8');

  ok('iPhone only', /TARGETED_DEVICE_FAMILY = 1;/.test(pbx));
  ok('deployment target is iOS 16.0', /IPHONEOS_DEPLOYMENT_TARGET = 16\.0;/.test(pbx));
  ok('bundle identifier is frozen',
    /PRODUCT_BUNDLE_IDENTIFIER = com\.ramramstudios\.astropitch;/.test(pbx));
  ok('builds against the iOS SDK', /SDKROOT = iphoneos;/.test(pbx));
  ok('uses the checked-in Info.plist, not a generated one',
    /GENERATE_INFOPLIST_FILE = NO;/.test(pbx)
      && /INFOPLIST_FILE = AstroPitch\/Info\.plist;/.test(pbx));

  // A fresh clone has an empty www/ (it is gitignored), so the only thing
  // between that and a blank shipped app is this phase running every build.
  ok('a shell script phase runs sync-www.sh', /sync-www\.sh/.test(pbx));
  ok('the sync phase ignores dependency analysis', /alwaysOutOfDate = 1;/.test(pbx));

  // A yellow group flattens src/audio/*.js into the bundle root and the app
  // launches to a blank screen; resolveEmbeddedWww() needs the real tree.
  const wwwRef = pbx.match(/isa = PBXFileReference;[^}]*path = AstroPitch\/www;[^}]*}/)?.[0] ?? '';
  ok('www is a folder reference, not a group', /lastKnownFileType = folder;/.test(wwwRef), wwwRef);

  // The run script has to produce www/ before Copy Bundle Resources reads it.
  const phases = pbx.match(/buildPhases = \(([\s\S]*?)\);/)?.[1] ?? '';
  ok('the sync phase is ahead of Copy Bundle Resources',
    phases.indexOf('Sync www') >= 0
      && phases.indexOf('Sync www') < phases.indexOf('Resources */'),
    phases.replace(/\s+/g, ' ').trim());

  for (const name of ['AppDelegate.swift', 'WebViewController.swift', 'OtaUpdater.swift']) {
    ok(`${name} is in the target's sources`,
      new RegExp(`${name.replace('.', '\\.')} in Sources`).test(pbx));
  }
  for (const name of ['Assets.xcassets', 'PrivacyInfo.xcprivacy', 'www']) {
    ok(`${name} is in the target's resources`,
      new RegExp(`${name.replace('.', '\\.')} in Resources`).test(pbx));
  }

  // Phase 3.3 (Now Playing) is skipped with background audio, and linking
  // MediaPlayer without using it is the kind of thing that draws a comment.
  ok('MediaPlayer is not linked', !/MediaPlayer/.test(pbx));
}

console.log('--- assets the launch screen and App Store need ---');
{
  const assets = join(root, ...IOS, 'Assets.xcassets');
  ok('asset catalogue exists', existsSync(assets));
  ok('LaunchBackground colour set exists',
    existsSync(join(assets, 'LaunchBackground.colorset', 'Contents.json')));

  const colors = JSON.parse(readFileSync(join(assets, 'LaunchBackground.colorset', 'Contents.json'), 'utf8'));
  ok('LaunchBackground has a light and a dark appearance', colors.colors.length === 2);
  // Same two values manifest.json already uses, so the launch screen hands off
  // to the web app without a flash.
  const hex = (c) => [c.color.components.red, c.color.components.green, c.color.components.blue].join('');
  ok('light matches manifest background_color #f4f4f2',
    hex(colors.colors.find((c) => !c.appearances)).toLowerCase() === '0xf40xf40xf2');
  ok('dark matches manifest theme_color #0b0b0b',
    hex(colors.colors.find((c) => c.appearances)).toLowerCase() === '0x0b0x0b0x0b');

  ok('AppIcon has a 1024 marketing image',
    existsSync(join(assets, 'AppIcon.appiconset', 'AppIcon-1024.png')));
}

console.log('--- OTA stays off for the first review ---');
{
  // One fewer thing doing network I/O during review, and the shipped bundle is
  // unambiguously what the reviewer sees. Turn it on in 1.0.1.
  ok('bundle.json updateUrl is empty', bundle.updateUrl === '');
}

console.log(fails ? `\n${fails} FAILED` : '\nAll native shell checks passed.');
process.exit(fails ? 1 : 0);
