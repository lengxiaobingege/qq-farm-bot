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
  wechatAutoRelogin?: boolean;
  hasCode?: boolean;
  hasLoginBuffer?: boolean;
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}
