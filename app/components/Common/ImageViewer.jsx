import React, { Fragment } from 'react'
import { Stack, Text, Clickable, Box, Button, Image } from '../ui'

const ImageViewer = (
    { label,
        src,
        alt = 'image',
        inlineSize = 'fill',
        objectFit = 'contain',
        onModalOpen,
        onRemoveOpen,
    }) => {
    return (
        <Fragment>
            <Stack gap="small-200">
                {label ? <Text>{label}</Text> : null}
                <Clickable onClick={onModalOpen} borderRadius="base" inlineSize={'290px'} blockSize={'120px'} minBlockSize={'120px'}>
                    <Box inlineSize={'290px'} blockSize={'120px'} minBlockSize={'120px'} borderRadius="base" border="base" borderColor="strong" borderStyle="dashed">
                        {src ? (
                            <Image
                                src={src}
                                inlineSize={inlineSize}
                                objectFit={objectFit}
                                alt={alt}
                            />
                        ) : (
                            <Stack direction={"inline"} paddingBlockStart="large-500" justifyContent={"center"} alignItems={"center"}>
                                <Button onClick={onModalOpen}>Select Image</Button>
                            </Stack>
                        )}
                    </Box>
                </Clickable>
                {src ?
                    <Stack direction="inline" gap="small-200" alignItems="center">
                        <Button tone={"secondary"} onClick={onModalOpen}>Change Image</Button>
                        <Button tone={"critical"} onClick={onRemoveOpen}>Remove Image</Button>
                    </Stack>
                    : null}
            </Stack>
        </Fragment>
    )
}

export default React.memo(ImageViewer);