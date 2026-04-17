import { useQuery } from "@tanstack/react-query";

type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  photoDataUrl: string | null;
  cell: string | null;
  onboardedAt: string | null;
  buildCompletedAt: string | null;
  isAdmin: boolean;
  termsAcceptedAt: string | null;
};

export function useAuth() {
  const { data, isLoading } = useQuery<User | null>({ queryKey: ["/api/auth/user"] });
  return { user: data ?? null, isLoading };
}
