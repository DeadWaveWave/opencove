# OpenCove plugins

This directory is the versioned guide for OpenCove extensions. The first built in
extension is [Git Board](./GIT_BOARD_MVP.md).

The first plugin API is deliberately small: a plugin declares a manifest, adds
commands through the Control Surface, and renders a node inside the existing
canvas shell. Renderer code does not access Node.js or the file system directly.

Use `opencove plugin guide` to print the absolute path to this README and the
plugin documentation directory installed with the current OpenCove build.
