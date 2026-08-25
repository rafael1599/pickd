import type { ManualContent } from './types.ts';

export const fedexDimensionsImport: ManualContent = {
  intro:
    'Ship Manager rates every shipment from the box sizes in its own Dimensions database. ' +
    'Wrong or missing sizes are what cause the FedEx re-measurement charges.',
  steps: [
    {
      title: 'Close the day — only if something shipped today',
      body: 'Open the Close tab and run both the Express and the Ground close. Si no se ha enviado nada hoy, salta este paso.',
      screen: 'FedEx Ship Manager → Close',
      fields: [],
      figures: [],
    },
    {
      title: 'Back up first',
      body: 'Haz una copia de seguridad seleccionando la base de datos de Dimensions. Esta copia es tu seguro de vida si la importación falla.',
      screen: 'Databases → File Maintenance → Backup',
      action: 'Backup',
      fields: [],
      figures: [],
    },
    {
      title: 'Import the CSV',
      body: 'Busca el archivo MASTER-DIMENSIONS.csv exportado desde PickD en tu escritorio.',
      screen: 'Databases → File Maintenance → Import',
      action: 'Replace current data → OK',
      warning: 'Siempre debes marcar "Replace current data". Merge y Append no funcionarán.',
      fields: [],
      figures: [],
    },
    {
      title: 'Check the numbers before you close it',
      body: 'Los "Processed" deben ser igual al número de filas en tu archivo CSV y los errores deben ser 0.',
      screen: 'Databases → File Maintenance → View Dimensions',
      fields: [],
      figures: [],
    },
    {
      title: 'Back up again',
      body: 'Haz otra copia de seguridad para guardar el nuevo estado (el nuevo catálogo).',
      screen: 'Databases → File Maintenance → Backup',
      fields: [],
      figures: [],
    },
  ],
  reference: [],
  warnings: [],
  faqs: [
    {
      question: '¿Qué hacer si la importación sale mal?',
      answer:
        'Ve a Databases → File Maintenance → Restore. Elige la copia de seguridad que hiciste en el paso 2 y asegúrate de elegir el modo Replace. Verifica los datos en View Dimensions al terminar.',
    },
    {
      question: '¿Por qué Merge o Append no funcionan?',
      answer:
        'Replace es la única opción segura porque vacía y vuelve a llenar la base de datos. Merge salta los IDs existentes (tus ediciones no se guardan) y Append los duplica.',
    },
    {
      question: '¿Errores al importar (Errors > 0)?',
      answer:
        'Es un problema de formato (comillas extra, delimitadores mal puestos, o IDs duplicados). Abre el CSV, corrige el error y vuelve a importar (usar Replace permite repetir el proceso sin daño).',
    },
    {
      question: '¿Cómo agregar nuevos modelos?',
      answer:
        'Exporta el CSV desde PickD actualizado. Si la caja no está en PickD, primero dásela de alta en PickD y luego corre la exportación.',
    },
  ],
};
