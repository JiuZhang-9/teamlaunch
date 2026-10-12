; TeamLaunch NSIS 安装脚本钩子（electron-builder include）
;
; 唯一目的：在**已提权的安装阶段**创建防火墙入站规则。
; 这是 ADR-004 选 electron-builder 的决定性理由 —— 规则必须在提权阶段建，
; 用户态进程无权调用 netsh advfirewall。
;
; 只在「为所有用户安装」（$installMode == "all"）时执行：
;   - per-user 安装（员工机「仅我」）没有提权，netsh 必然失败 —— 不判模式就会出现
;     "打印了正在创建规则、其实一条都没建"的假动作；
;   - 更糟的是 per-user 卸载若照删，会把同一台机器上管理员机的规则删掉。
; 员工端本来就不需要入站规则：内嵌服务只在管理员角色下启动（backendService），
; 客户端从不监听端口。
;
; 规则约束（Spec §10）：
;   - 仅 TCP 17890-17899（服务端口范围，真实端口靠 UDP 17891 信标广播告知）
;   - -RemoteAddress LocalSubnet：不接受来自子网外的连接
;   - profile=DOMAIN,PRIVATE：公用网络配置文件下刻意不生效（K-01，诊断页会提示切换）

!macro customInstall
  ${if} $installMode == "all"
    DetailPrint "正在为 TeamLaunch 创建内网入站规则…"

    ; 先删后建：重复安装时不留重复规则（netsh 允许同名规则，会导致规则叠加）
    ExecWait '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="TeamLaunch 同步服务 (TCP 17890-17899)"'

    ExecWait '"$SYSDIR\netsh.exe" advfirewall firewall add rule \
      name="TeamLaunch 同步服务 (TCP 17890-17899)" \
      dir=in action=allow protocol=TCP localport=17890-17899 \
      remoteip=LocalSubnet profile=DOMAIN,PRIVATE \
      program="$INSTDIR\TeamLaunch.exe"'

    ; 发现用 UDP 17891（广播 + 单播应答）。刻意否决 mDNS：那要求每台员工机开 UDP 5353 入站，
    ; 会摧毁零配置前提（K-03）。
    ExecWait '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="TeamLaunch 服务发现 (UDP 17891)"'
    ExecWait '"$SYSDIR\netsh.exe" advfirewall firewall add rule \
      name="TeamLaunch 服务发现 (UDP 17891)" \
      dir=in action=allow protocol=UDP localport=17891 \
      remoteip=LocalSubnet profile=DOMAIN,PRIVATE \
      program="$INSTDIR\TeamLaunch.exe"'
  ${endif}
!macroend

!macro customUnInstall
  ${if} $installMode == "all"
    ExecWait '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="TeamLaunch 同步服务 (TCP 17890-17899)"'
    ExecWait '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="TeamLaunch 服务发现 (UDP 17891)"'
  ${endif}
!macroend
