/**
 * The ONE loopback/LAN table (G-SUB-06). Both the child's rule
 * (src/endpoint.ts) and the kernel's (packages/gnomon/src/kernel/local/
 * endpoint.ts) are tested against it, so the two copies cannot drift.
 * [base, expected class or refusal]
 */
export const ENDPOINT_TABLE: ReadonlyArray<[string, string]> = [
  ['http://127.0.0.1:8080', 'loopback'],
  ['http://127.9.9.9:1234/', 'loopback'],
  ['http://localhost:11434', 'loopback'],
  ['http://[::1]:8080', 'loopback'],
  ['http://0x7f.1:8080', 'loopback'],
  ['http://2130706433:8080', 'loopback'],
  ['http://[::ffff:127.0.0.1]:8080', 'loopback'],
  ['http://10.0.0.5:8080', 'lan'],
  ['http://172.16.3.4:1234', 'lan'],
  ['http://172.31.255.255:1234', 'lan'],
  ['http://192.168.1.20:8000', 'lan'],
  ['https://192.168.1.20', 'lan'],
  ['http://[fd12:3456::1]:8080', 'lan'],
  ['http://[::ffff:192.168.0.9]:80', 'lan'],
  ['http://172.32.0.1:8080', 'public'],
  ['http://8.8.8.8:8080', 'public'],
  ['http://[2606:4700::1111]:443', 'public'],
  ['http://169.254.169.254/latest', 'link-local'],
  ['http://[fe80::1]:8080', 'link-local'],
  ['http://0.0.0.0:8080', 'unspecified'],
  ['http://[::]:8080', 'unspecified'],
  ['https://api.anthropic.com', 'anthropic-host'],
  ['https://claude.ai', 'anthropic-host'],
  ['http://10.evil.example:8080', 'hostname'],
  ['http://my-gpu-box.local:8080', 'hostname'],
  ['https://api.openai.com/v1', 'hostname'],
  ['ftp://127.0.0.1:21', 'scheme'],
  ['file:///etc/passwd', 'scheme'],
  ['http://user:pw@127.0.0.1:8080', 'userinfo'],
  ['not a url', 'malformed'],
];
