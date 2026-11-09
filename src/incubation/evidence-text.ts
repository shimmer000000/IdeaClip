// Pure text only. Shared by the local recorder and the extension, never a command parser.
export function evidenceText(value:string):string {
 return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g,'')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[已移除私钥]')
  .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16})\b/g,'[已移除凭据]')
  .replace(/\bBearer\s+\S+/gi,'[已移除凭据]')
  .replace(/\b(?:authorization|cookie|set-cookie|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|client[_ -]?secret)\s*["']?\s*[:=][^\r\n]*/gi,'[已移除敏感配置]')
  .replace(/https?:\/\/[^\s"'<>]+/gi,'[外部链接已移除]')
  .replace(/["'][A-Za-z]:[\\/][^"'\r\n]*["']/g,'[已移除本机路径]')
  .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g,'[已移除本机路径]')
  .replace(/(?:^|[\s"'=])\/(?:[A-Za-z0-9_.-]+\/)[^\r\n]*/gm,' [已移除本机路径]')
  .replace(/\b[A-Z_][A-Z0-9_]*\s*=\s*[^\r\n]*/g,'[已移除环境配置]')
  .replace(/\$env:\w+|\$\{[A-Za-z_]\w*\}|%[A-Za-z_]\w*%/gi,'[已移除环境引用]')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
}
