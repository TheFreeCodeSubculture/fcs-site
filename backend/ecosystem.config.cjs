module.exports = {
  apps: [
    {
      name: "fcs-backend",
      script: "dist/server.js",
      cwd: "/srv/fcs-api/current",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "5050",
        FCS_ENV_FILE: "/srv/fcs-api/shared/.env",
      },
      out_file: "/srv/fcs-api/shared/logs/out.log",
      error_file: "/srv/fcs-api/shared/logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
