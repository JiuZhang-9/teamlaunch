/**
 * Windows 控制台输出的读取与解码（K-12 的唯一落点）。
 *
 * 为什么必须有这一层：`reg.exe` 这类 **Windows 控制台程序**的输出按**系统代码页**编码
 * （中文 Windows = 936/GBK），而 Node 拿到字节后默认按 **UTF-8** 解 —— 中文名会变成乱码
 * （2026-10-11 实测：「已安装程序」名字出现 `ДК◆◆` 这类形状）。
 * 只读英文路径的旧用法（App Paths）碰不到这个坑，但只要出现中文就会踩。
 *
 * 规则：读这类输出必须 `regQueryBytes` 拿字节 → `decodeConsoleOutput` 按 ACP 解码；
 * 或改用 PowerShell + JSON（显式 UTF-8）。**不要**直接用 `execFile(..., {encoding:'utf8'})`。
 */
import { execFile } from 'node:child_process';

/** 系统 ANSI 代码页 → 解码器。 */
function decoderForCodePage(acp: number): TextDecoder | null {
  const label =
    acp === 936 ? 'gbk'
    : acp === 950 ? 'big5'
    : acp === 932 ? 'shift_jis'
    : acp === 949 ? 'euc-kr'
    : acp >= 1250 && acp <= 1258 ? `windows-${acp}`
    : null;
  if (label === null) return null;
  try {
    return new TextDecoder(label);
  } catch {
    // 运行时没带这个解码器（无完整 ICU）→ 退回 UTF-8
    return null;
  }
}

let ansiDecoderPromise: Promise<TextDecoder | null> | null = null;

/** 取本机 ANSI 代码页（每会话一次，缓存）：ACP 值本身是 ASCII，不存在解码递归。 */
export function ansiDecoder(): Promise<TextDecoder | null> {
  if (ansiDecoderPromise === null) {
    ansiDecoderPromise = (async () => {
      const bytes = await regQueryBytes([
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
        '/v',
        'ACP',
      ]);
      if (bytes === null) return null;
      const m = /REG_SZ\s+(\d+)/.exec(bytes.toString('latin1'));
      if (m === null) return null;
      return decoderForCodePage(Number(m[1]));
    })();
  }
  return ansiDecoderPromise;
}

/** 跑一次 reg query，拿**原始字节**（解码交给调用方；数组传参 + 超时，K-04/K-05 同款纪律）。 */
export function regQueryBytes(args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      args,
      { timeout: 4000, windowsHide: true, encoding: 'buffer' },
      (err, stdout) => resolve(err ? null : (stdout as unknown as Buffer)),
    );
  });
}

/** 跑一次 reg query 并按系统代码页解码成文本（失败返回 null）。 */
export async function regQueryText(args: string[]): Promise<string | null> {
  const bytes = await regQueryBytes(args);
  if (bytes === null) return null;
  const decoder = await ansiDecoder();
  return decoder !== null ? decoder.decode(bytes) : bytes.toString('utf8');
}

/** 按系统代码页解控制台输出；拿不到代码页就退回 UTF-8（纯 ASCII 内容两者一致）。 */
export async function decodeConsoleOutput(bytes: Buffer): Promise<string> {
  const decoder = await ansiDecoder();
  return decoder !== null ? decoder.decode(bytes) : bytes.toString('utf8');
}
