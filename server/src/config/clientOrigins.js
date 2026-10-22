const { env } = require("./env");

function getAllowedClientOrigins() {
  return [...new Set([
    "https://www.charmingfurfectionpetscareservices.online",
    "https://charmingfurfectionpetscareservices.online",
    "https://api.charmingfurfectionpetscareservices.online",
    "https://capstone-project-1-yqto.onrender.com",
    "http://localhost:5173",
    "http://localhost:3000",
    ...env.clientUrl.split(","),
  ].map(value => value.trim()).filter(Boolean))];
}

module.exports = { getAllowedClientOrigins };
