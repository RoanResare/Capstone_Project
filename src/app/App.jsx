import { RouterProvider } from "react-router-dom";
import { router } from "./routes.jsx";
import { AppProvider } from "./context/AppContext.jsx";

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );
}
