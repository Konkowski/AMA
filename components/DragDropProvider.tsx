// ============================================================
// AMA — Drag & Drop Provider (dnd-kit wrapper)
// ============================================================
import React, { useState } from 'react';
import {
    DndContext, DragOverlay, DragStartEvent, DragEndEvent,
    PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { useStore } from '../lib/store';
import type { EntityLevel } from '../types/machine';

interface DragDropProviderProps {
    children: React.ReactNode;
}

export const DragDropProvider: React.FC<DragDropProviderProps> = ({ children }) => {
    const assignFBToEntity = useStore(s => s.assignFBToEntity);
    const addToAssembly = useStore(s => s.addToAssembly);
    const [activeDragItem, setActiveDragItem] = useState<{ id: string; type: string; name: string } | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current;
        if (data) {
            setActiveDragItem({
                id: data.id || event.active.id.toString(),
                type: data.type,
                name: data.name || data.fbName || 'Unknown Item'
            });
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragItem(null);
        const { active, over } = event;
        if (!over) return;

        const activeData = active.data.current;
        const overData = over.data.current;

        // 1. Assign FB to Entity (Architecture/Library)
        if (activeData?.type === 'fb' && overData?.type === 'node') {
            assignFBToEntity(overData.nodeId, overData.nodeLevel as EntityLevel, activeData.fbId);
        }

        // 2. Add Entity to Assembly (Assembly Page)
        if (activeData?.type === 'arch-entity' && overData?.type === 'asm-node') {
            // overData.nodeId is the PARENT assembly node ID
            // activeData.entityId is the reference ID of the UN/EM to add
            // activeData.level is 'UN' or 'EM'
            addToAssembly(overData.nodeId, activeData.entityId, activeData.level);
        }

        // 3. Drop on "Root" of assembly (if we have a root drop zone)
        if (activeData?.type === 'arch-entity' && overData?.type === 'asm-root') {
            addToAssembly(null, activeData.entityId, activeData.level);
        }
    };

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            {children}
            <DragOverlay dropAnimation={null}>
                {activeDragItem && (
                    <div className="drag-overlay">
                        {activeDragItem.type === 'fb' ? '⚙️' : activeDragItem.type === 'arch-entity' ? '📦' : '📄'} {activeDragItem.name}
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
};
