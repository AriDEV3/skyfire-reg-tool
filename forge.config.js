module.exports = {
  packagerConfig: {
    asar: true, // Packt den Code in ein sicheres Archiv
    executableName: "SkyfirePortal"
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel', // Erstellt die eigenständige Setup.exe
      config: {
        name: 'skyfire_reg_tool',
      },
    },
    {
      name: '@electron-forge/maker-zip', // Erstellt ein einfaches .zip Archiv
      platforms: ['win32'], // Explizit für Windows gesetzt (win32 gilt auch für x64 Windows)
    }
  ],
};