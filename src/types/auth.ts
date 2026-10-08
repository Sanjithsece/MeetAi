export type Role = "ADMIN" | "USER";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  department?: string;
  timezone?: string;
  avatarInitials?: string;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  role?: Role;
  department?: string;
};

export type AuthSession = {
  token: string;
  refreshToken?: string;
  user: AuthUser;
};
