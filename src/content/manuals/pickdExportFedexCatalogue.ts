import type { ManualContent } from './types.ts';

export const pickdExportFedexCatalogue: ManualContent = {
  intro:
    'Antes de actualizar FedEx Ship Manager, necesitas descargar el catálogo más reciente de dimensiones de cajas desde PickD.',
  steps: [
    {
      title: 'Ir a Settings → Exports',
      body: 'En la barra lateral de PickD, haz clic en Settings y luego en la pestaña Exports.',
      action: 'Haz clic en Settings',
      fields: [],
      figures: [],
    },
    {
      title: 'Exportar el Catálogo',
      body: 'Busca la sección "FedEx Dimensions" y haz clic en Exportar.',
      action: 'Export CSV',
      fields: [],
      figures: [],
    },
    {
      title: 'Guardar el archivo',
      body: 'Guarda el archivo MASTER-DIMENSIONS.csv descargado en tu Escritorio o en una carpeta accesible (como C:\\Users\\FedEx\\Desktop\\).',
      fields: [],
      figures: [],
    },
  ],
  warnings: [],
  reference: [],
  faqs: [
    {
      question: '¿Por qué necesito hacer esto primero?',
      answer:
        'PickD contiene las medidas reales de todas las cajas en bodega. Al exportar este catálogo, garantizas que FedEx utilice las medidas precisas más recientes y evitar sobrecargos.',
    },
  ],
};
