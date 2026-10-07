/**
 * src/shared/constants.ts —— 端口、超时、阈值与协议常量（架构 §3.3 已登记本文件）
 *
 * 分工：容量上限（8 组 / 200 入口 / 1MB）定义在 `schema/common.ts` 的 CAPACITY，
 * 本文件**不重复定义**容量，只放协议与运行时阈值，避免两处定义分叉。
 *
 * 所有时间单位统一为毫秒，命名带 Ms 后缀；任何一处写错单位的代价都是静默的。
 */

/** 服务监听端口区间（ADR-004）。实际端口可能因占用漂移，必须靠 UDP 信标对外广播。 */
export const TCP_PORT_RANGE = { start: 17890, end: 17899 } as const;

/** 期望的（也是首选的）TCP 端口。实际端口不等于它时诊断报 PORT_DRIFTED。 */
export const PREFERRED_TCP_PORT = TCP_PORT_RANGE.start;

/** 服务发现 UDP 端口（ADR-002）。 */
export const UDP_DISCOVERY_PORT = 17891;

/** 监听地址。必须是 0.0.0.0，否则局域网不可达（ADR-004）。 */
export const LISTEN_ADDRESS = '0.0.0.0';

/** API 版本前缀。不兼容变更新增 /api/v2/，v1 并行至少 6 个月（T8）。 */
export const API_PREFIX = '/api/v1';

/** 信标协议哨兵。不匹配即丢弃，保证将来换协议不串（ADR-002）。 */
export const BEACON_MAGIC = 'TLDISCOVER1';

/** 发现阶梯各层超时（ADR-002 / 架构 T1.3）。 */
export const DISCOVERY_TIMEOUTS = {
  l0ManualOverrideMs: 1500,
  l1KnownEndpointMs: 1500,
  l2BeaconProbeMs: 2500,
  l3LanScanMs: 4000,
  /** 单次 HTTP 确认（/health）超时。 */
  healthCheckMs: 1200,
} as const;

/** L3 网段扫描的限频与并发（254 次 SYN 会触发安全软件告警，必须限频）。 */
export const LAN_SCAN = {
  minIntervalMs: 5 * 60 * 1000,
  concurrency: 96,
  perHostTimeoutMs: 250,
  maxKnownEndpoints: 3,
} as const;

/**
 * `discovery.json` 的写入节流窗口（架构师收口的纪律）。
 *
 * 员工端每 30 秒轮询一次，成功就会走到"记住端点"。若每次都 tmp+fsync+rename，
 * 长跑下来是实打实的写放大（还会反复唤醒磁盘）。端点三要素没变就不写盘。
 */
export const DISCOVERY_PERSIST_THROTTLE_MS = 5 * 60 * 1000;

/** 鉴权与签名（ADR-006）。 */
export const AUTH = {
  /** 挑战有效期：60 秒。 */
  challengeTtlMs: 60 * 1000,
  /** 令牌有效期：8 小时，仅内存不落盘。 */
  tokenTtlMs: 8 * 60 * 60 * 1000,
  /** 时间戳容许偏差：±120 秒。 */
  timestampSkewMs: 120 * 1000,
  /** nonce 去重窗口：5 分钟。 */
  nonceTtlMs: 5 * 60 * 1000,
  nonceMaxLength: 128,
  /** 5 分钟内失败超过 10 次 → 锁定 15 分钟。 */
  verifyFailureWindowMs: 5 * 60 * 1000,
  verifyMaxFailures: 10,
  lockoutMs: 15 * 60 * 1000,
  /**
   * scrypt 参数（N=2^15, r=8, p=1, keylen=32）。
   *
   * `maxmem` 必须显式给。Node 实际拿来和上限比较的用量是
   *   `128·N·r + 128·r·p` = 128·32768·8 + 128·8·1 = 33,555,456 B
   * 而 Node/OpenSSL 的默认上限是 32 MiB = 33,554,432 B —— **只超出 1,024 B**。
   * 不设 maxmem 就抛 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS: memory limit exceeded`，
   * 表现是"设置口令"这一步直接失败，管理员永远设不了口令。
   *
   * 覆盖范围：64 MiB 只够 `N ≤ 2^15`。**提高 N 必须同步抬高 maxmem**，
   * 否则改一行常量就能让口令派生全线抛错（且只在真机上暴露，架构师已实测）。
   *
   * 注意：`maxmem` 刻意**不上线**（不是 ChallengeInfo.kdf 的字段）。
   * N/r/p 本身就是线上字段，攻击面早已存在，多带一个可伪造参数挡不住任何向量；
   * 真正的防线是客户端拿到 N/r/p 后先与本地常量比对，见 shared/kdf.ts。
   */
  scrypt: { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 },
  saltBytes: 32,
  challengeBytes: 32,
  /** 口令最短长度。错误文案不得泄露该规则，见 errors.ts。 */
  minPasswordLength: 8,
} as const;

/** 限流配额（ADR-006 §4）。内存计数，重启清零是可接受的。 */
export const RATE_LIMIT = {
  /** 挑战申请：每设备每分钟。 */
  challengePerMinute: 30,
  /** 反馈：每设备每小时 20 条（按条数计费，不是按请求数）。 */
  feedbackItemsPerHour: 20,
  /** 遥测：每设备每分钟 1 批。 */
  telemetryBatchesPerMinute: 1,
  /** 写端点与巡检：每设备每分钟。 */
  writePerMinute: 60,
  /** 拉取配置：每设备每分钟（防止轮询失控打爆管理员机）。 */
  readPerMinute: 120,
} as const;

/** 反馈去重窗口：同一 (deviceId, entryId, reasonCode) 24 小时内只记一次。 */
export const FEEDBACK_DEDUPE_MS = 24 * 60 * 60 * 1000;

/** 保留策略。 */
export const RETENTION = {
  /** 变更记录与快照各保留最近 20 条/个（PRD P0-11）。 */
  revisions: 20,
  /** 服务端收到的反馈条目上限，超出后重写淘汰最旧的。 */
  feedbackItems: 5000,
  /** 遥测聚合中保留的匿名设备 ID 上限（只用于去重计数，不做行为回放）。 */
  telemetryDeviceIds: 1000,
} as const;

/**
 * 请求体上限：1 MB。Fastify bodyLimit 之外再用它做二次判定，
 * 因为 bodyLimit 只按字节卡，错误码需要在业务层可控。
 */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * 写请求签名覆盖的 HTTP 方法。GET/HEAD 不走签名——它们的语义是幂等读取，
 * 且 `GET /revisions` 与 `GET /diagnostics` 只靠 Bearer 令牌保护（openapi 契约如此）。
 */
export const SIGNED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * 写请求 Content-Type 白名单：**只有裸 `application/json`**。
 *
 * 不接受 `application/json; charset=utf-8` 之类的变体。原因不是洁癖：
 * HMAC 验的是原始字节串，任何编码/参数差异都会让"看起来一样的请求"算出不同签名，
 * 且失败是随机的，现场会被误判成网络问题（架构已点名的最易错点 1）。
 */
export const STRICT_JSON_CONTENT_TYPE = 'application/json';

/** 签名串的字段分隔。用换行而不是冒号，避免与 path 中的冒号混淆。 */
export const SIGNATURE_FIELD_SEPARATOR = '\n';

/** 签名相关头部名。 */
export const SIGNATURE_HEADERS = {
  timestamp: 'x-tl-timestamp',
  nonce: 'x-tl-nonce',
  signature: 'x-tl-signature',
} as const;

/** 匿名设备标识头部（仅用于限流与去重，非硬件信息）。 */
export const DEVICE_ID_HEADER = 'x-tl-device-id';

/** 诊断项标识，顺序与诊断页展示顺序一致（openapi DiagnosticCheck.id 枚举）。 */
export const DIAGNOSTIC_CHECK_IDS = [
  'SERVICE_LISTENING',
  'PORT_RANGE',
  'FIREWALL_RULES',
  'NETWORK_PROFILE',
  'LAN_ADDRESSES',
  'DATA_INTEGRITY',
] as const;

/**
 * topIssue 判定优先级（架构 §14.2）。取第一个命中的。
 *
 * PUBLIC_NETWORK_PROFILE 刻意排在 FIREWALL_RULE_MISSING 之前：公用网络下防火墙规则
 * 是"已创建且已启用"的，先报规则缺失会让管理员盯着一条正常规则反复排查（K-01）。
 */
export const TOP_ISSUE_PRIORITY = [
  'SERVICE_NOT_LISTENING',
  'PUBLIC_NETWORK_PROFILE',
  'FIREWALL_RULE_MISSING',
  'PORT_DRIFTED',
  'DATA_INTEGRITY_FAILED',
  'PEER_UNVERIFIED',
  'NONE',
] as const;

/** 两条防火墙规则的显示名（ADR-004）。规则由提权安装器创建，此处只做巡检。 */
export const FIREWALL_RULE_NAMES = {
  tcp: 'TeamLaunch Sync TCP',
  udp: 'TeamLaunch Discovery UDP',
} as const;

/** 外部命令执行超时。任何 spawn 都必须带超时，UNC 下线路径可能挂住（K-05）。 */
export const SPAWN_TIMEOUT_MS = 4000;

/** 本机文件 IO 超时兜底（ADR-005：本地 500ms / UNC 1500ms）。 */
export const IO_TIMEOUT_MS = { local: 500, remote: 1500 } as const;
