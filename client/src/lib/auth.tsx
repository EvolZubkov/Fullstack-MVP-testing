import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User } from "@shared/schema";
import { hasPermission, type Role, type Capability } from "@shared/access";

/**
 * User as returned by the auth API: DB fields plus the effective role set and
 * permission list computed by the server (PRD-13). `roles` includes the
 * configuration superadmin when applicable; `permissions` is the union.
 * `magicScope` is present only for a session opened by an assignment link and
 * names the single test that session may reach.
 */
export type AuthUser = User & {
  roles?: Role[];
  permissions?: Capability[];
  magicScope?: { testId: string } | null;
};

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Whether the current user holds the given capability (PRD-13). */
  can: (cap: Capability) => boolean;
  /** Whether the current user has the given effective role. */
  hasRole: (role: Role) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setUser(null);
    }
  };

  /**
   * Capability check (PRD-13). Prefers the server-provided permission list;
   * falls back to computing from the role set via the shared access layer.
   */
  const can = useCallback(
    (cap: Capability): boolean => {
      if (!user) return false;
      if (user.permissions) return user.permissions.includes(cap);
      if (user.roles) return hasPermission(user.roles, cap);
      return false;
    },
    [user],
  );

  const hasRole = useCallback(
    (role: Role): boolean => !!user?.roles?.includes(role),
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, checkAuth, refreshUser: checkAuth, can, hasRole }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
