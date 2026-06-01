import { useAuth } from "@getmocha/users-service/react";
import { useRemoteWorkspace } from "@/react-app/contexts/RemoteWorkspaceContext";

export function useEffectiveUser() {
  const { user } = useAuth();
  const { isRemote, remoteUser, error } = useRemoteWorkspace();

  return {
    localUser: user,
    effectiveUser: isRemote ? remoteUser : user,
    isRemoteWorkspace: isRemote,
    isResolvingRemoteUser: isRemote && !remoteUser && !error,
  };
}
