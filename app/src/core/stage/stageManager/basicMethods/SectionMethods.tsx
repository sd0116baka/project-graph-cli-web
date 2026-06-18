import { Vector } from "@graphif/data-structures";
import { Project, service } from "@/core/Project";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { StageObject } from "@/core/stage/stageObject/abstract/StageObject";

@service("sectionMethods")
export class SectionMethods {
  constructor(protected readonly project: Project) {}

  /**
   * 获取一个实体的它自己的父亲Sections、是第一层所有父亲Sections
   * 注：需要遍历所有Section
   * @param entity
   */
  getFatherSections(entity: Entity): Section[] {
    const result = [];
    for (const section of this.project.stageManager.getSections()) {
      if (section.children.includes(entity)) {
        result.push(section);
      }
    }
    return result;
  }

  /**
   * 检查舞台对象是否在锁定的Section内
   * 对于实体：检查它的所有父Section是否有锁定的
   * 对于连线：检查它连接的所有实体是否在锁定的Section内
   * @param object 舞台对象（实体或连线）
   * @returns 如果对象连接了锁定的Section内物体，返回true
   */
  isObjectBeLockedBySection(object: StageObject): boolean {
    if (object instanceof Entity) {
      // 检查实体本身是否是锁定的Section
      if (object instanceof Section && object.locked) {
        return true;
      }
      // 检查实体是否在任何锁定的祖先Section内
      const ancestorSections = this.getFatherSectionsList(object);
      return ancestorSections.some((section) => section.locked);
    } else if (object instanceof Edge) {
      // 对于有向边，检查source和target是否在锁定的Section内
      const sourceAncestorSections = this.getFatherSectionsList(object.source);
      const targetAncestorSections = this.getFatherSectionsList(object.target);
      return (
        sourceAncestorSections.some((section) => section.locked) ||
        targetAncestorSections.some((section) => section.locked)
      );
    } else if (object instanceof MultiTargetUndirectedEdge) {
      // 对于无向边，检查所有关联实体是否在锁定的Section内
      for (const entity of object.associationList) {
        const ancestorSections = this.getFatherSectionsList(entity);
        if (ancestorSections.some((section) => section.locked)) {
          return true;
        }
      }
      return false;
    }
    // 其他类型的舞台对象（如未知类型）默认返回false
    return false;
  }

  /**
   * 获取一个实体被他包围的全部实体，一层一层的包含并以数组返回
   * A{B{C{entity}}}
   * 会返回 [C, B, A]
   * @param entity
   */
  getFatherSectionsList(entity: Entity): Section[] {
    const result = [];
    for (const section of this.project.stageManager.getSections()) {
      if (this.isEntityInSection(entity, section)) {
        result.push(section);
      }
    }
    return this.getSortedSectionsByZ(result).reverse();
  }

  /**
   * 根据一个位置，获取包含这个位置的所有Section（深Section优先）
   * 例如在十字位置上，获取到的结果是 [B]
   *               │
   *     ┌─────────┼────────────────────────┐
   *     │A        │                        │
   *     │  ┌──────┼──────┐   ┌───────┐     │
   *     │  │B     │      │   │C      │     │
   *─────┼──┼──────┼──────┼───┼───────┼─────┼─────
   *     │  │      │      │   │       │     │
   *     │  └──────┼──────┘   └───────┘     │
   *     │         │                        │
   *     └─────────┼────────────────────────┘
   *               │
   * @returns
   */
  getSectionsByInnerLocation(location: Vector): Section[] {
    const sections: Section[] = [];
    for (const section of this.project.stageManager.getSections()) {
      if (section.isCollapsed || section.isHiddenBySectionCollapse) {
        continue;
      }
      if (section.collisionBox.getRectangle().isPointIn(location)) {
        sections.push(section);
      }
    }
    return this.deeperSections(sections);
  }

  /**
   * 用于去除重叠集合，当有完全包含的集合时，返回最小的集合
   * @param sections
   */
  private deeperSections(sections: Section[]): Section[] {
    const outerSections: Section[] = []; // 要被排除的Section

    for (const sectionI of sections) {
      for (const sectionJ of sections) {
        if (sectionI === sectionJ) {
          continue;
        }
        if (this.isEntityInSection(sectionI, sectionJ) && !this.isEntityInSection(sectionJ, sectionI)) {
          // I 在 J 中，J不在I中，J大，排除J
          outerSections.push(sectionJ);
        }
      }
    }
    const result: Section[] = [];
    for (const section of sections) {
      if (!outerSections.includes(section)) {
        result.push(section);
      }
    }
    return result;
  }

  /**
   * 通过多个Section，获取最外层的Section（即没有父亲的Section）
   * @param sections
   * @returns
   */
  shallowerSection(sections: Section[]): Section[] {
    const rootSections: Section[] = [];
    const sectionMap = new Map<string, Section>();
    // 首先将所有section放入map，方便快速查找
    for (const section of sections) {
      sectionMap.set(section.uuid, section);
    }
    // 遍历所有section，检查是否有父亲节点
    for (const section of sections) {
      for (const child of section.children) {
        sectionMap.delete(child.uuid);
      }
    }
    for (const section of sectionMap.keys()) {
      const result = sectionMap.get(section);
      if (result) {
        rootSections.push(result);
      }
    }

    return rootSections;
  }

  shallowerNotSectionEntities(entities: Entity[]): Entity[] {
    // shallowerSection + 所有非Section的实体
    const sections = entities.filter((entity) => entity instanceof Section);
    const nonSections = entities.filter((entity) => !(entity instanceof Section));
    // 遍历所有非section实体，如果是任何一个section的子节点，则删除
    const result: Entity[] = [];
    for (const entity of nonSections) {
      let isAnyChild = false;
      for (const section of sections) {
        if (this.isEntityInSection(entity, section)) {
          isAnyChild = true;
        }
      }
      if (!isAnyChild) {
        result.push(entity);
      }
    }
    result.push(...sections);
    return result;
  }

  /**
   * 检测某个实体是否在某个集合内，跨级也算
   * @param entity
   * @param section
   */
  isEntityInSection(entity: Entity, section: Section): boolean {
    return this._isEntityInSection(entity, section, 0);
  }

  private _isEntityInSection(entity: Entity, section: Section, deep = 0): boolean {
    if (deep > 996) {
      return false;
    }
    // 直接先检测一级
    if (section.children.includes(entity)) {
      return true;
    } else {
      // 涉及跨级检测
      for (const child of section.children) {
        if (child instanceof Section) {
          if (this._isEntityInSection(entity, child, deep + 1)) {
            return true;
          }
        }
      }
      return false;
    }
  }

  /**
   * 检测一个Section内部是否符合树形嵌套结构
   * @param rootNode
   */
  isTreePack(rootNode: Section) {
    const dfs = (node: Entity, visited: Entity[]): boolean => {
      if (visited.includes(node)) {
        return false;
      }
      visited.push(node);
      if (node instanceof Section) {
        for (const child of node.children) {
          if (!dfs(child, visited)) {
            return false;
          }
        }
      }
      return true;
    };
    return dfs(rootNode, []);
  }

  /**
   * 返回一个分组框的最大嵌套深度
   * @param section
   */
  getSectionMaxDeep(section: Section): number {
    const visited: Section[] = [];
    const dfs = (node: Section, deep = 1): number => {
      if (visited.includes(node)) {
        return deep;
      }
      visited.push(node);
      for (const child of node.children) {
        if (child instanceof Section) {
          deep = Math.max(deep, dfs(child, deep + 1));
        }
      }
      return deep;
    };
    return dfs(section);
  }

  /**
   * 用途：
   * 根据选中的多个Section，获取所有选中的实体（包括子实体）
   * 可以解决复制多个Section时，内部实体的连线问题
   * @param selectedEntities
   */
  getAllEntitiesInSelectedSectionsOrEntities(selectedEntities: Entity[]): Entity[] {
    const entityUUIDSet = new Set<string>();
    const dfs = (currentEntity: Entity) => {
      if (currentEntity.uuid in entityUUIDSet) {
        return;
      }
      if (currentEntity instanceof Section) {
        for (const child of currentEntity.children) {
          dfs(child);
        }
      }
      entityUUIDSet.add(currentEntity.uuid);
    };
    for (const entity of selectedEntities) {
      dfs(entity);
    }
    return this.project.stageManager.getEntitiesByUUIDs(Array.from(entityUUIDSet));
  }

  getSortedSectionsByZ(sections: Section[]): Section[] {
    // 先按y排序，从上到下，先不管z
    return sections.sort((a, b) => a.collisionBox.getRectangle().top - b.collisionBox.getRectangle().top);
  }
}
