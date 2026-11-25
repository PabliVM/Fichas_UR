// ================================================
// TILDES.JS — Propone la forma con tilde de nombres y apellidos españoles
// ("ADRIAN GARCIA" → "ADRIÁN GARCÍA"). Palabra a palabra, solo si la palabra
// sin tilde está en la lista; respeta MAYÚSCULAS / Capitalizada / minúsculas.
// Solo propone: lo aplica el usuario desde Configuración › Datos pendientes.
// ================================================

const PALABRAS = `
Adrián Álvaro Ángel Andrés Aarón Abraham Agustín Ainhoa Álex Amelia Anaís Aníbal Antonio Asunción Baltasar Belén Benjamín Bernabé Bruno Caín Camilo Carlota Cecilia Cristián Cristóbal Damián Daniel Darío Dámaso Débora Dídac Efraín Elías Eloísa Emilio Esteban Eugenio Fabián Fermín Fidel Gabriel Germán Gonzalo Guillermo Héctor Hernán Hugo Iñaki Iñigo Íñigo Ismael Iván Jaime Jesús Joaquín Jonás Josué José Julián Lucía Lázaro Leonardo Lisandro Marcos Martín Matías Máximo Mía Miguel Moisés Nicolás Noé Óscar Pablo Patricio Pío Rafael Ramón Raúl Rodrigo Román Rubén Salomón Samuel Sebastián Sergio Simón Sofía Tomás Valentín Víctor Yeray Yaiza Zoé Jerónimo Rosalía Inés Mónica Ángela Verónica Bárbara Natalia Raquel Ruth Lía Iria Nerea Eneko Unai Aitor Asier Mikel Gorka Joseba Álex
Pérez García González Fernández López Martínez Sánchez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Álvarez Muñoz Romero Alonso Gutiérrez Navarro Torres Domínguez Vázquez Ramos Gil Ramírez Serrano Blanco Suárez Molina Morales Ortega Delgado Castro Ortiz Rubio Marín Sanz Núñez Iglesias Medina Garrido Cortés Castillo Santos Lozano Guerrero Cano Prieto Méndez Cruz Calvo Gallego Vidal León Márquez Herrera Peña Flores Cabrera Campos Vega Fuentes Carrasco Díez Caballero Reyes Nieto Aguilar Pascual Santana Herrero Lorenzo Hidalgo Montero Ibáñez Giménez Ferrer Durán Santiago Benítez Mora Vicente Vargas Arias Carmona Crespo Román Pastor Soto Sáez Velasco Moya Soler Parra Esteban Bravo Gallardo Rojas Pardo Merino Franco Espinosa Izquierdo Lara Rivas Silva Rivera Casado Arroyo Redondo Camacho Rey Vera Otero Luque Galán Montes Ríos Sierra Segura Carrillo Marcos Marín Robles Bermúdez Benavente Cuesta Rodríguez Sáinz Sáenz Ordóñez Ibáñez Peláez Álvarez Ramírez Báez Jaén Chacón Gascón Castellón Guzmán Colón Galván Beltrán Aragón Calderón Rincón Monzón Obregón Pinzón Bretón Betrán Barragán Maldonado Andújar Céspedes Cáceres Cárdenas Ávila Lucía Muñiz Mejía Tejón Rosón Durán Valdés Cortés Solís Gálvez Vélez Téllez Sáez Juárez Suárez Valverde Cobos Ojeda Lázaro Simón Tomás Nicolás Julián Ramón Germán Adrián Sebastián Iruretagoyena Hernando Escudero Pacheco Martí Sevilla Ballesteros Bonilla Rosales Saldaña Peñalver Mañas Muñiz Cañete Patiño Íñiguez Ibarrola Echeverría Zubiría Garmendia Larrañaga Urquijo Azcárate Olivares Villalba Lacosta Mena Palomo Córcoba Velasco Castellanos Aceituno Pagonessa Nogales Santamaría Ruiz Pozo Vadillo Bellosillo Almeida Lemaitre Bailón Sáez Capatana Lacosta Company Sarmiento Suárez Beobide Castrelo Orce Morilla Hurtado Espuela Quiteria Poyatos Castelló Abascal Pertea Alba Gandía Torondel Contreras Talavera Marrero Patrascu Balsera Badas Krall Gálvez Ríos Bermejo Cerezo Pagán Carrión Sanjuán Valentín Jesús María Ángeles Concepción Encarnación Purificación
Castaño Oñate Estefanía Begoña Montaño Cañizares Avilés Gámez Barrón Morón Marañón Bolaños Nuño Saúl Elián Velázquez Enríquez Antúnez Yáñez Viñas Cañas Treviño Zúñiga Quiñones Peñas Tomé Muñoz Núñez Peña Ibáñez Ordóñez Gómez Benítez Domínguez Fernández Rodríguez Vázquez Andújar Valdés Pérez Ramón Joaquín Rubén Aarón Héctor Víctor Óscar Iván Raúl Álvaro Adrián Andrés Jesús José Ángel Darío Matías Tomás Nicolás Sebastián Julián Martín Agustín Fermín Benjamín Cristóbal Valentín Germán Damián Fabián Máximo Román Simón Jonás Noé Moisés Elías Lucía Sofía María
`;

const sinTilde = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Solo palabras que llevan tilde (las demás no cambian nada).
const tieneMarcas = w => w.normalize('NFD') !== w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Palabra sin tilde (en minúsculas) → su forma correcta. Solo las que llevan tilde o ñ.
const MAPA = Object.fromEntries(PALABRAS.split(/\s+/).filter(w => w && tieneMarcas(w)).map(w => [sinTilde(w), w]));

function conMismoFormato(original, correcta) {
  if (original === original.toUpperCase()) return correcta.toLocaleUpperCase('es');
  if (original === original.toLowerCase()) return correcta.toLocaleLowerCase('es');
  return correcta.charAt(0).toLocaleUpperCase('es') + correcta.slice(1).toLocaleLowerCase('es');
}

/** Texto con las tildes que faltan (solo palabras de la lista). */
export function ponerTildes(texto) {
  return String(texto || '').replace(/\p{L}+/gu, w => {
    if (tieneMarcas(w)) return w; // ya lleva tilde o ñ: se deja como está
    const c = MAPA[sinTilde(w)];
    return c ? conMismoFormato(w, c) : w;
  });
}
