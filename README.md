# Resonix

Multi-platform prebuilt binaries and Node.js wrapper for the Resonix audio node.

## Packages

This monorepo contains:

- `resonix` - TypeScript/JS API
  - Note: The Resonix node now resolves YouTube/SoundCloud streams via the Rust `riva` crate and streams them directly instead of downloading mp3 caches. The native node only requires `ffmpeg` for codec fallback/transcoding.
- Platform-specific binary packages (`@resonix/linux-x86_64`, etc.)
- `@resonix/node` - Node.js launcher / CLI shim

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## License

BSD-3-Clause (see [LICENSE](LICENSE)).
