export {};
export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  uin: string;
  qq: string;
  /** 游戏角色编号（面板「角色编号」），登录后由服务器下发 */
  gid?: string;
  avatar: string;
  nick?: string;
  createdAt: number;
  updatedAt: number;
  loginBuffer?: string;
  wxOpenId?: string;
  wxAccessToken?: string;
  wxRefreshToken?: string;
  wxExpiresAt?: number;
  wxExpiresIn?: number;
  wxLoginType?: string;
  wxRefreshTokenObservedAt?: number;
  /** 上次成功刷新微信会话（code / access token）的时间，毫秒；用于「每小时刷新一次」节流 */
  wxSessionRefreshedAt?: number;
  wechatAutoRelogin?: boolean;
  hasCode?: boolean;
  hasLoginBuffer?: boolean;
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}
