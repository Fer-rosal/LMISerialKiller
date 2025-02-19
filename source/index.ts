import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';

// Cargar variables de entorno desde el archivo .env
dotenv.config();

// Ruta al archivo CSV
const csvFilePath: string = process.env.PATH_TO_CSV || './hosts.csv';

// Token de autenticación desde el .env
const username: string | undefined = process.env.USERNAME;
const password: string | undefined = process.env.PASSWORD;

// Codificar las credenciales en base64
const basicAuth: string = Buffer.from(`${username}:${password}`).toString('base64');

// Tipo para la respuesta de hosts
interface Host {
    description: string;
    id: number;
}

// Tipo para la respuesta de inventario
interface InventoryResponse {
    hosts: Record<string, { hostId: number; serviceTag: string }>;
    report: { token: string | null };
}

// Función para leer el CSV y extraer cada nombre a un array
function readFileAndParseToArray(filePath: string): string[] {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data.split('\n').map(item => item.trim());
    } catch (error) {
        console.error('Error al leer el fichero:', error);
        return [];
    }
}

// Función para obtener hosts de la API de LogMeIn
async function getHosts(): Promise<number[]> {
    const hostIds: number[] = [];
    try {
        const response = await axios.get<{ hosts: Host[] }>('https://secure.logmein.com/public-api/v2/hosts', {
            headers: {
                'Authorization': `Basic ${basicAuth}`
            }
        });
        response.data.hosts.forEach(host => {
            hostIds.push(host.id);
        });
    } catch (error: any) {
        console.error('Error al obtener los hosts:', error.response ? error.response.data : error.message);
    }
    return hostIds;
}

// Función para solicitar un reporte de inventario
async function requestInventoryReport(hostIds: number[]): Promise<string | null> {
    try {
        const response = await axios.post<{ token: string }>('https://secure.logmein.com/public-api/v1/inventory/hardware/reports', {
            hostIds: hostIds,
            fields: ["ServiceTag"]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${basicAuth}`
            }
        });
        return response.data.token;
    } catch (error: any) {
        console.error('Error solicitando el reporte de inventario:', error.response ? error.response.data : error.message);
    }
    return null;
}

// Función para obtener el reporte de inventario usando el token
async function getInventoryReport(token: string): Promise<InventoryResponse | null> {
    try {
        const response = await axios.get<InventoryResponse>(`https://secure.logmein.com/public-api/v1/inventory/hardware/reports/${token}`, {
            headers: {
                'Authorization': `Basic ${basicAuth}`
            }
        });
        return response.data;
    } catch (error: any) {
        console.error('Error obteniendo el reporte de inventario:', error.response ? error.response.data : error.message);
    }
    return null;
}

// Función principal para ejecutar el programa
(async function main() {
    try {
        const serials: string[] = readFileAndParseToArray(csvFilePath);
        console.log('Serials leídos del CSV:', serials);

        const hostIds: number[] = await getHosts();
        console.log('IDs obtenidos de LogMeIn:', hostIds);

        const token: string | null = await requestInventoryReport(hostIds);
        if (!token) {
            console.error('No se pudo obtener el token de inventario.');
            return;
        }

        const inventoryMap = new Map<string, number>();
        let nextToken: string | null = token;

        while (nextToken) {
            const report: InventoryResponse | null = await getInventoryReport(nextToken);
            if (report && typeof report === 'object') {
                Object.keys(report.hosts).forEach(key => {
                    const host = report.hosts[key];
                    inventoryMap.set( host.serviceTag, host.hostId);
                });
                nextToken = report.report.token;
            } else {
                nextToken = null;
            }
        }

        console.log('Inventario obtenido');

        //guardamos el inventario obtenido en un archivo CSV
        const wsInventory = fs.createWriteStream('InventoryObtenido.csv');
        wsInventory.write('serviceTag,hostId\n');
        inventoryMap.forEach((hostId, serviceTag) => {
            wsInventory.write(`${serviceTag},${hostId}\n`);
        });
        wsInventory.end();
        console.log('Inventario guardado en InventoryObtenido.csv');

        //ahora que tenemos todos los hostId y los ServiceTAg
        //buscamos en el Map los ServiceTag que coicidan con los serials
        //y creamos un nuevo Map con solo los serial y hostID que coincidan

        const inventoryMapFiltered = new Map<number, string>();
        const inventoryNotFound: string[]=[];
        serials.forEach(serial => {
            if (inventoryMap.has(serial)) {
                inventoryMapFiltered.set(inventoryMap.get(serial) as number, serial);
                console.log(`Serial ${serial} encontrado en el inventario.`);   
            }
            else {
                inventoryNotFound.push(serial);
                console.log(`Serial ${serial} no encontrado en el inventario.`);
            }
            });
        

        // Guardar el inventario en un CSV
        const ws = fs.createWriteStream('Inventory.csv');
        ws.write('id,serviceTag\n');
        inventoryMapFiltered.forEach((serviceTag, id) => {
            ws.write(`${id},${serviceTag}\n`);
        });
        ws.end();
        console.log('Inventario guardado en Inventory.csv');
        
        //guardamos el array de serials no encontrado en otro csv
        const wsNotFound = fs.createWriteStream('InventoryNotFound.csv');
        wsNotFound.write('serviceTag\n');
        inventoryNotFound.forEach((serviceTag) => {
            wsNotFound.write(`${serviceTag}\n`);
        });
        wsNotFound.end();
        console.log('Serials no encontrados guardados en InventoryNotFound.csv');

   } catch (error) {
        console.error('Error en el procesamiento:', error);
    }
})();
