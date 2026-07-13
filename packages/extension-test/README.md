# @kun/extension-test

Deterministic, credential-free test utilities for Kun extensions. The harness
provides a fake Host transport plus workspace, Agent, tool, provider, account,
storage, network, permission, clock, Webview, protected media, durable job, and
generated-artifact services. Media and job fakes use a controllable clock and
explicit lifecycle methods, so tests never require FFmpeg or wall-clock waits.
