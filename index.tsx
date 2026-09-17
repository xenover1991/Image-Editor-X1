/*
 * ImageEditor - Developed by xen (206993987125510144)
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile } from "@utils/web";
import { Menu } from "@webpack/common";

import "./styles.css";
import { EditorModal } from "./ui/EditorModal";

export const settings = definePluginSettings({
    hotkey: {
        type: OptionType.STRING,
        description: "Resim Düzenleyiciyi açmak için kısayol tuşu (Varsayılan: Ctrl+Alt+I veya Ctrl+Shift+E)",
        default: "Ctrl+Alt+I"
    }
});

export function openEditorModal(source?: string | File | null, targetMessage?: any) {
    openModal(modalProps => (
        <ModalRoot {...modalProps} size={ModalSize.DYNAMIC} className="xen-modal-root">
            <EditorModal initialSource={source ?? null} targetMessage={targetMessage ?? null} onClose={modalProps.onClose} />
        </ModalRoot>
    ));
}

const onKeydown = (e: KeyboardEvent) => {
    // Check if user pressed Ctrl+Alt+I or Ctrl+Shift+E
    const isHotkey = (e.ctrlKey || e.metaKey) && (
        (e.altKey && e.key.toLowerCase() === "i") ||
        (e.shiftKey && e.key.toLowerCase() === "e")
    );

    if (isHotkey) {
        e.preventDefault();
        e.stopPropagation();
        openEditorModal();
    }
};

const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const src = props?.src ?? (props?.target as HTMLImageElement)?.src ?? (props as any)?.itemSrc;
    if (!src) return;

    const group = findGroupChildrenByChildId("copy-native-link", children)
        ?? findGroupChildrenByChildId("open-native-link", children)
        ?? findGroupChildrenByChildId("copy-image", children);

    const item = (
        <Menu.MenuItem
            id="xen-image-editor"
            label="Resmi Düzenle"
            action={() => openEditorModal(src, props?.message)}
        />
    );

    if (group) {
        group.push(item);
    } else {
        children.push(
            <Menu.MenuGroup id="xen-img-editor-group" key="xen-img-editor-group">
                {item}
            </Menu.MenuGroup>
        );
    }
};

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const items: { name: string; url: string }[] = [];

    if (props?.message?.attachments) {
        for (const a of props.message.attachments) {
            if (a.content_type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.url ?? "")) {
                items.push({ name: a.filename ?? "Ek Resim", url: a.url });
            }
        }
    }

    if (props?.message?.embeds) {
        for (const emb of props.message.embeds) {
            if (emb.image?.url) {
                items.push({ name: "Embed Resmi", url: emb.image.url });
            } else if (emb.thumbnail?.url) {
                items.push({ name: "Embed Küçük Resmi", url: emb.thumbnail.url });
            }
        }
    }

    if (items.length === 0) return;

    if (items.length === 1) {
        children.push(
            <Menu.MenuGroup id="xen-msg-editor-group" key="xen-msg-editor-group">
                <Menu.MenuItem
                    id="xen-msg-image-editor"
                    label="Resmi Düzenle"
                    action={() => openEditorModal(items[0].url, props?.message)}
                />
            </Menu.MenuGroup>
        );
    } else {
        children.push(
            <Menu.MenuGroup id="xen-msg-editor-group" key="xen-msg-editor-group">
                <Menu.MenuItem
                    id="xen-msg-image-editor-group"
                    label="Resmi Düzenle"
                >
                    {items.map((item, idx) => (
                        <Menu.MenuItem
                            key={item.url + idx}
                            id={`xen-msg-img-${idx}`}
                            label={item.name}
                            action={() => openEditorModal(item.url, props?.message)}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuGroup>
        );
    }
};

const channelAttachPatch: NavContextMenuPatchCallback = (children, _props) => {
    children.push(
        <Menu.MenuGroup id="xen-attach-editor-group" key="xen-attach-editor-group">
            <Menu.MenuItem
                id="xen-attach-image-editor"
                label="Resmi Düzenle & Gönder"
                action={async () => {
                    const file = await chooseFile("image/*");
                    if (file) openEditorModal(file);
                }}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "ImageEditor",
    description: "developed by xen",
    authors: [
        {
            name: "xen",
            id: 206993987125510144n
        }
    ],
    tags: ["Media", "Utility"],
    settings,

    start() {
        window.addEventListener("keydown", onKeydown);
    },

    stop() {
        window.removeEventListener("keydown", onKeydown);
    },

    contextMenus: {
        "image-context": imageContextMenuPatch,
        "message": messageContextMenuPatch,
        "channel-attach": channelAttachPatch
    }
});
