"use client";

import { useQuery } from "@tanstack/react-query";
import { queries } from "./queries";
import { useAuth } from "@/contexts/AuthContext";

export function useRecommendations(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({ ...queries.config(), enabled: user !== null });
  return data?.recommendationsEnabled === true;
}
