/**
 * src/shared/kdf.ts —— 口令派生的唯一入口（服务端与客户端共用一份）
 *
 * 存在理由是一条**潜伏约束**（架构师收口时点名）：
 * `N`/`r`/`p` 是线上字段（ChallengeInfo.kdf 里随挑战下发）。一个被冒充的、
 * 或已失陷的实例只要回 `N=2^20`，客户端就会去分配
 * `128·2^20·8 = 1 GB` 内存 —— **不需要拿到任何口令就能让机器卡死**。
 * 当前 N/r/p 是固定单档所以还没暴露，但一旦有人把它变成可配置，这就是硬要求。
 * 现在就夹紧，成本是几行。
 *
 * 两条防线，缺一不可：
 *   1. `assertTrustedKdf`：客户端拿到线上参数后先与本地常量**严格比对**，
 *      不一致即拒绝并提示"服务端不受信任"，**不尝试派生**。
 *   2. `deriveVerifier`：不论参数来自哪里，只要内存用量超过 `AUTH.scrypt.maxmem`
 *      就先拒绝 —— 这是兜底网，防止将来有人只改了常量而忘了改夹紧。
 *
 * `maxmem` 本身刻意不上线（见 constants.ts 的说明）：多带一个可伪造参数
 * 挡不住任何向量，真正的防线是"只信任本地那一档参数"。
 */

import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { AUTH } from './constants.ts';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export interface KdfParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

/** Node 拿来与 maxmem 比较的用量（架构师实测口径，勿改成 OpenSSL 内部那套账）。 */
export function scryptMemoryBytes(N: number, r: number, p: number): number {
  return 128 * N * r + 128 * r * p;
}

/** 该组参数在给定上限下是否安全（不传上限时按本地常量判定）。 */
export function fitsMaxmem(params: KdfParams, maxmem: number = AUTH.scrypt.maxmem): boolean {
  return scryptMemoryBytes(params.N, params.r, params.p) <= maxmem;
}

/** 严格等于本地常量 —— 客户端对**线上**参数的判定口径。 */
export function isTrustedKdf(params: KdfParams): boolean {
  return (
    params.N === AUTH.scrypt.N
    && params.r === AUTH.scrypt.r
    && params.p === AUTH.scrypt.p
    && params.keylen === AUTH.scrypt.keylen
  );
}

export class UntrustedKdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UntrustedKdfError';
  }
}

/**
 * 客户端在派生之前必须先过这一关。失败时**不要**回退到"试试看"：
 * 试一次就已经被打到了。
 */
export function assertTrustedKdf(params: KdfParams): void {
  if (!isTrustedKdf(params)) {
    throw new UntrustedKdfError(
      '服务端下发的口令派生参数与本机不一致，该数据源不受信任，已中止登录',
    );
  }
}

/**
 * 派生 verifier。任何来源的参数都会先过内存上限这道网，
 * 且 maxmem 一律显式传入（否则 Node 默认 32 MiB 会让 N=2^15 直接抛错）。
 */
export async function deriveVerifier(
  password: string,
  salt: Buffer | string,
  params: KdfParams,
): Promise<Buffer> {
  if (!fitsMaxmem(params)) {
    throw new UntrustedKdfError(
      `口令派生参数所需内存（${scryptMemoryBytes(params.N, params.r, params.p)} B）超过上限`,
    );
  }
  return scryptAsync(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: AUTH.scrypt.maxmem,
  });
}

/** 服务端设置口令时用：参数取本地常量，永远是"受信任"的那一档。 */
export async function deriveWithLocalParams(password: string, salt: Buffer | string): Promise<Buffer> {
  return deriveVerifier(password, salt, {
    N: AUTH.scrypt.N,
    r: AUTH.scrypt.r,
    p: AUTH.scrypt.p,
    keylen: AUTH.scrypt.keylen,
  });
}
