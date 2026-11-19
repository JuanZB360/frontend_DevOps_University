/**
 * Plan de estudios completo de DevOps University.
 *
 * Orden de las carreras: Linux → Nginx → Docker → Git/GitHub → CI/CD →
 * Bases de datos → Monitoreo → Infraestructura como código → Kubernetes.
 *
 * `chapters` contiene los capítulos ya jugables; `upcoming` los que están
 * planificados. Para publicar un capítulo nuevo basta con moverlo de una
 * lista a la otra creando su archivo de misiones.
 */
import type { CurriculumModule } from '../domain/curriculum';
import { chapter01 } from './linux/chapter01-despertar';
import { chapter02 } from './linux/chapter02-filesystem';
import { chapter03 } from './linux/chapter03-archivos';
import { chapter04 } from './linux/chapter04-leer';
import { chapter05 } from './linux/chapter05-redirecciones';
import { chapter06 } from './linux/chapter06-buscar';
import { chapter07 } from './linux/chapter07-texto';
import { chapter08 } from './linux/chapter08-usuarios';
import { chapter09 } from './linux/chapter09-permisos';
import { chapter10 } from './linux/chapter10-procesos';
import { chapter11 } from './linux/chapter11-paquetes';
import { chapter12 } from './linux/chapter12-entorno';
import { chapter13 } from './linux/chapter13-scripting';
import { chapter14 } from './linux/chapter14-comprimir';
import { chapter15 } from './linux/chapter15-discos';
import { chapter16 } from './linux/chapter16-redes';
import { chapter17 } from './linux/chapter17-ssh';
import { chapter18 } from './linux/chapter18-servicios';
import { chapter19 } from './linux/chapter19-cron';
import { chapter20 } from './linux/chapter20-logs';
import { chapter21 } from './linux/chapter21-firewall';
import { chapter22 } from './linux/chapter22-rendimiento';
import { chapter23 } from './linux/chapter23-final';
import { DOCKER_CHAPTERS } from './docker/chapters';
import { nginxChapter06, nginxChapter07, nginxChapter08, nginxChapter09, nginxChapter10, nginxChapter11, nginxChapter12, nginxChapter13, nginxChapter14 } from './nginx/chapters-advanced';
import { nginxChapter01, nginxChapter02, nginxChapter03, nginxChapter04, nginxChapter05 } from './nginx/chapters-basics';

export const MODULES: readonly CurriculumModule[] = [
  {
    id: 'linux',
    title: 'Linux',
    tagline: 'De cero a administrar un servidor de producción',
    graduationRank: 'Root',
    chapters: [
      chapter01, chapter02, chapter03, chapter04, chapter05, chapter06, chapter07, chapter08, chapter09, chapter10, chapter11,
      chapter12, chapter13, chapter14, chapter15, chapter16, chapter17, chapter18, chapter19, chapter20, chapter21, chapter22, chapter23,
    ],
    upcoming: [],
  },
  {
    id: 'nginx',
    title: 'Nginx',
    tagline: 'Servidor web, proxy inverso y balanceo de carga',
    graduationRank: 'Web Master',
    chapters: [
      nginxChapter01, nginxChapter02, nginxChapter03, nginxChapter04, nginxChapter05, nginxChapter06, nginxChapter07,
      nginxChapter08, nginxChapter09, nginxChapter10, nginxChapter11, nginxChapter12, nginxChapter13, nginxChapter14,
    ],
    upcoming: [],
  },
  {
    id: 'docker',
    title: 'Docker',
    tagline: 'Contenedores de cero a experto',
    graduationRank: 'Container Captain',
    chapters: [...DOCKER_CHAPTERS],
    upcoming: [],
  },
  {
    id: 'git',
    title: 'Git y GitHub',
    tagline: 'Control de versiones y colaboración',
    graduationRank: 'Git Guardian',
    chapters: [],
    upcoming: [
      'Repositorios y commits', 'Historial y diferencias', 'Ramas', 'Merge y conflictos', 'Rebase',
      'Remotos y GitHub', 'Pull requests y code review', 'Git flow y trunk-based', 'Tags y releases',
      'Recuperar desastres (reflog, reset, revert)', 'JEFE FINAL: Colaboración en equipo',
    ],
  },
  {
    id: 'cicd',
    title: 'CI/CD',
    tagline: 'Integración y despliegue continuo',
    graduationRank: 'Pipeline Pilot',
    chapters: [],
    upcoming: [
      'Conceptos de CI/CD', 'GitHub Actions: primer workflow', 'Tests automáticos', 'Build de imágenes Docker',
      'Secrets y entornos', 'Despliegue por SSH', 'Despliegue sin caída (blue/green)', 'Rollbacks',
      'JEFE FINAL: Pipeline completo hasta producción',
    ],
  },
  {
    id: 'databases',
    title: 'Bases de datos en producción',
    tagline: 'PostgreSQL, MySQL y Redis',
    graduationRank: 'Data Keeper',
    chapters: [],
    upcoming: ['PostgreSQL', 'MySQL', 'Redis', 'Backups y restauración', 'Réplicas'],
  },
  {
    id: 'monitoring',
    title: 'Monitoreo',
    tagline: 'Saber qué pasa antes que tus usuarios',
    graduationRank: 'Watchtower',
    chapters: [],
    upcoming: ['Métricas con Prometheus', 'Dashboards con Grafana', 'Logs centralizados', 'Alertas', 'Uptime Kuma'],
  },
  {
    id: 'iac',
    title: 'Infraestructura como código',
    tagline: 'Ansible y Terraform',
    graduationRank: 'Infra Architect',
    chapters: [],
    upcoming: ['Ansible', 'Terraform'],
  },
  {
    id: 'kubernetes',
    title: 'Kubernetes',
    tagline: 'El doctorado DevOps',
    graduationRank: 'DevOps Architect',
    chapters: [],
    upcoming: ['Pods', 'Deployments', 'Services', 'Ingress', 'Helm'],
  },
];
