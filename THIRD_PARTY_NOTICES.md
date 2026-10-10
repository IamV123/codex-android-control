# Third-party notices

The original application and desktop source are MIT licensed. Their license does not replace licenses for third-party tools and dependencies.

- Gradle wrapper scripts and JAR: Gradle, Inc., Apache License 2.0; see `licenses/Apache-2.0.txt` and the copyright headers in the generated scripts. Generated with official Gradle 9.1.0.
- `qrcode` 1.5.4: MIT; https://github.com/soldair/node-qrcode. Transitive dependency names, versions, integrity hashes and license identifiers are in `desktop/package-lock.json`; their license files are installed by `npm ci`.
- Cloudflared 2026.10.0: Cloudflare, Apache License 2.0; https://github.com/cloudflare/cloudflared. The executable is downloaded separately from the official release and hash-verified; it is not committed to this repository or bundled into the desktop ZIP.
- The optional/default temporary relay uses the LocalTunnel public protocol documented at https://github.com/localtunnel/localtunnel (MIT). This project implements its small adapter using Node built-ins; it does not install or bundle the upstream LocalTunnel client. The relay is a third-party testing service, not operated by this project.
- Android SDK, Android Gradle Plugin and JDK are build prerequisites, not bundled SDK installations. The app uses Android framework APIs and has no third-party Android runtime dependency.
