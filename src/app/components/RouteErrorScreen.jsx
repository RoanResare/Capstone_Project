import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { RecoveryScreen } from "./RecoveryScreen.jsx";

function describeRouteError(error) {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText || "Route error"}`.trim();
  }

  if (error instanceof Error) {
    return error.message || error.name || "Unknown route error.";
  }

  return "Unknown route error.";
}

export function RouteErrorScreen() {
  const error = useRouteError();

  return (
    <RecoveryScreen
      eyebrow="Route Recovery"
      title="This page hit an error while React Router was loading the route."
      message="Refreshing with cleared browser state usually resolves stale route data or cached app-state mismatches."
      detail={describeRouteError(error)}
    />
  );
}
