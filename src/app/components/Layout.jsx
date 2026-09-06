import { useEffect, useState } from "react";
import { Outlet, Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, LayoutDashboard, LogOut, Menu, UserRound, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { BrandMark } from "./BrandMark.jsx";
import { AskLlamaAI } from "./AskLlamaAI.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { resolveHomePath } from "../utils/roleUtils.js";

const landingNavItems = [{ id: "home", label: "Home" }];

function getDisplayName(user) {
  return user?.fullName || user?.name || user?.email || "Account";
}

function getInitials(user) {
  return getDisplayName(user)
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, signOut } = useAuth();
  const dashboardPath = currentUser ? resolveHomePath(currentUser.role) : "/login";
  const accountName = getDisplayName(currentUser);
  const accountItems =
    currentUser?.role === "customer"
      ? [
          { to: "/customer/dashboard", label: "Customer Dashboard", icon: LayoutDashboard },
          { to: "/customer/dashboard?tab=services", label: "Services", icon: LayoutDashboard },
          { to: "/customer/dashboard?tab=booking", label: "Book Appointment", icon: LayoutDashboard },
          { to: "/customer/dashboard?tab=appointments", label: "My Appointments", icon: LayoutDashboard },
          { to: "/customer/dashboard?tab=profile", label: "Manage Account", icon: UserRound },
        ]
      : [
          { to: dashboardPath, label: "Dashboard", icon: LayoutDashboard },
          { to: dashboardPath, label: "Manage Account", icon: UserRound },
        ];

  const closeMobileMenu = () => setMobileMenuOpen(false);
  const closeAccountMenu = () => setAccountMenuOpen(false);

  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) {
      return;
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (location.pathname !== "/") {
      return;
    }

    const targetSection =
      typeof location.state?.scrollTo === "string" && location.state.scrollTo.trim()
        ? location.state.scrollTo.trim()
        : location.hash
          ? location.hash.slice(1)
          : "home";
    const frameId = window.requestAnimationFrame(() => {
      scrollToSection(targetSection);
      if (location.hash) {
        navigate({ pathname: "/", search: location.search }, { replace: true });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname, location.hash, location.search]);

  const handleLandingNavClick = (sectionId) => {
    closeMobileMenu();
    closeAccountMenu();

    if (location.pathname === "/") {
      scrollToSection(sectionId);
      return;
    }

    navigate("/", { state: { scrollTo: sectionId } });
  };

  const handleDashboardClick = () => {
    closeMobileMenu();
    closeAccountMenu();
    navigate(dashboardPath);
  };

  const handleSignOut = async () => {
    closeMobileMenu();
    closeAccountMenu();
    await signOut();
    navigate("/");
  };

  const desktopScrollButtonClassName =
    "rounded-lg px-3 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-white/10";
  const desktopRouteLinkClassName = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-semibold text-white transition-all duration-200 ${
      isActive ? "bg-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" : "hover:bg-white/10"
    }`;
  const mobileLinkClassName = ({ isActive }) =>
    `block rounded-xl px-4 py-3 text-base font-semibold text-white transition-all duration-200 ${
      isActive ? "bg-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" : "hover:bg-white/10"
    }`;

  return (
    <div className="min-h-screen bg-[#F6F0E7]">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#2D9B9B] shadow-[0_2px_16px_rgba(34,65,71,0.15)]">
        <div className="mx-auto flex max-w-[1260px] items-center justify-between px-4 py-2 md:px-7">
          <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <BrandMark className="h-10 w-10 flex-shrink-0" />
            <span className="text-base font-semibold text-white md:text-[1.15rem]">
              Charming Fur-fection Pet Care Services
            </span>
          </Link>

          <div className="flex items-center gap-3 md:gap-5">
            <div className="hidden items-center gap-3 md:flex">
              {landingNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleLandingNavClick(item.id)}
                  className={desktopScrollButtonClassName}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleDashboardClick}
                className={desktopScrollButtonClassName}
              >
                Dashboard
              </button>
              {!currentUser ? (
                <NavLink to="/login" className={desktopRouteLinkClassName}>
                  Log In
                </NavLink>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAccountMenuOpen((open) => !open)}
                    className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/18"
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#F4C16A] text-xs font-bold text-[#173E44]">
                      {currentUser.photoURL ? (
                        <img
                          src={currentUser.photoURL}
                          alt={`${accountName} profile`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitials(currentUser)
                      )}
                    </span>
                    <span className="max-w-36 truncate">{accountName}</span>
                    <ChevronDown size={16} />
                  </button>

                  {accountMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-72 rounded-[24px] border border-[#DCEAEA] bg-white p-3 text-[#20343B] shadow-[0_22px_52px_rgba(20,43,46,0.2)]"
                    >
                      <div className="border-b border-[#EEF3F3] px-3 py-3">
                        <p className="font-semibold">{accountName}</p>
                        <p className="mt-1 truncate text-sm text-[#607277]">{currentUser.email}</p>
                      </div>
                      <div className="mt-2 grid gap-1">
                        {accountItems.map((item) => {
                          const Icon = item.icon;

                          return (
                            <Link
                              key={`${item.to}-${item.label}`}
                              to={item.to}
                              onClick={closeAccountMenu}
                              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-[#31565D] transition hover:bg-[#EEF6F6]"
                              role="menuitem"
                            >
                              <Icon size={16} />
                              {item.label}
                            </Link>
                          );
                        })}
                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-[#B23949] transition hover:bg-[#FBECEF]"
                          role="menuitem"
                        >
                          <LogOut size={16} />
                          Log Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className="md:hidden text-white p-2"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden bg-[#248080] md:hidden"
            >
              <div className="px-6 py-4 space-y-2">
                {landingNavItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLandingNavClick(item.id)}
                    className="block w-full rounded-xl px-4 py-3 text-left text-base font-semibold text-white transition-all duration-200 hover:bg-white/10"
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleDashboardClick}
                  className="block w-full rounded-xl px-4 py-3 text-left text-base font-semibold text-white transition-all duration-200 hover:bg-white/10"
                >
                  Dashboard
                </button>
                {!currentUser ? (
                  <NavLink to="/login" onClick={closeMobileMenu} className={mobileLinkClassName}>
                    Log In
                  </NavLink>
                ) : (
                  <div className="rounded-2xl bg-white/10 p-3 text-white">
                    <div className="flex items-center gap-3 px-1 py-2">
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#F4C16A] text-sm font-bold text-[#173E44]">
                        {currentUser.photoURL ? (
                          <img
                            src={currentUser.photoURL}
                            alt={`${accountName} profile`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          getInitials(currentUser)
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{accountName}</p>
                        <p className="truncate text-sm text-white/70">{currentUser.email}</p>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-1">
                      {accountItems.map((item) => (
                        <NavLink
                          key={`${item.to}-${item.label}`}
                          to={item.to}
                          onClick={closeMobileMenu}
                          className="rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                          {item.label}
                        </NavLink>
                      ))}
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        Log Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <main className="pt-16">
        <Outlet />
      </main>
      <AskLlamaAI />
    </div>
  );
}
