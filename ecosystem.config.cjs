module.exports = {
  apps: [
    {
      name: 'trugrade-api',
      cwd: '/var/www/Trugrade/apps/api',
      script: 'dist/main.js',
      env_file: '/var/www/Trugrade/.env',
      max_memory_restart: '800M',
    },
  ],
};
