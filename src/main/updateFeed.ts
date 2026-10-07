/**
 * 更新源注册表 —— 自动更新客户端与同步装配层之间的最小解耦点。
 *
 * 更新文件由管理员机的内嵌服务通过 /updates/ 静态路由对外提供：
 *  - 管理员机：服务起好后写本机回环地址（http://127.0.0.1:<port>）；
 *  - 员工机：同步客户端每轮成功解析端点后写该端点的 base URL，解析失败写 null。
 * updater 在每次检查前读它：null = 没有可信来源，静默跳过（绝不误报"更新失败"）。
 */

let base: string | null = null;

export function setUpdateFeedBase(next: string | null): void {
  base = next && next.replace(/\/+$/, '');
}

export function getUpdateFeedBase(): string | null {
  return base;
}
